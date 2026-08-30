"""layout_extract.py — Turn OCR/PDF output into a LayoutDocument.

Three producers feed the same model:
- ``cluster_words`` / ``extract_layout_from_image``: local tesseract word boxes
  clustered into lines -> columns -> KV items and table blocks (best-effort).
- ``extract_layout_from_pdf``: text-layer PDFs reuse pdfplumber tables plus
  regex key-value pairs; scanned PDFs render pages and reuse the word boxes.
- ``doc_parse_to_layout``: consumes the cloud doc-parse structured payload
  (markdown tables) without flattening the layout away.
"""

from __future__ import annotations

import re
from io import BytesIO
from typing import Any

from layout_doc import KVItem, LayoutDocument, TableBlock

#: Word confidence below this is treated as OCR noise (-1 means unrated).
MIN_WORD_CONF = 30
#: A label with at most this many characters is a key-value candidate.
MAX_KV_LABEL_LEN = 12
#: Column split gap relative to the median word width.
COL_GAP_RATIO = 0.6
MIN_COL_GAP = 8


def _valid_word(word: dict[str, Any]) -> bool:
    text = str(word.get("text") or "").strip()
    if not text:
        return False
    conf = word.get("conf", -1)
    if conf != -1 and conf < MIN_WORD_CONF:
        return False
    return word.get("width", 0) > 0 and word.get("height", 0) > 0


def _cluster_lines(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group words into text lines by vertical overlap, then sort by x."""
    ordered = sorted(words, key=lambda w: (w["top"], w["left"]))
    lines: list[dict[str, Any]] = []
    for word in ordered:
        top = int(word["top"])
        bottom = top + int(word["height"])
        for line in lines:
            if top <= line["bottom"] and bottom >= line["top"]:
                line["words"].append(word)
                line["top"] = min(line["top"], top)
                line["bottom"] = max(line["bottom"], bottom)
                break
        else:
            lines.append({"top": top, "bottom": bottom, "words": [word]})
    for line in lines:
        line["words"].sort(key=lambda w: w["left"])
    lines.sort(key=lambda line: line["top"])
    return lines


def _split_columns(
    line: dict[str, Any], gap_threshold: float
) -> list[dict[str, str]]:
    """Split a line's words into columns on horizontal gaps."""
    columns: list[dict[str, str]] = []
    for word in line["words"]:
        left = int(word["left"])
        right = left + int(word["width"])
        text = str(word["text"]).strip()
        if not text:
            continue
        if columns and left - columns[-1]["right"] <= gap_threshold:
            previous = columns[-1]
            previous["text"] = (previous["text"] + " " + text).strip()
            previous["right"] = max(previous["right"], right)
        else:
            columns.append({"text": text, "left": left, "right": right})
    return columns


def _median(values: list[float]) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return float(ordered[middle])
    return (ordered[middle - 1] + ordered[middle]) / 2.0


def _kv_from_columns(columns: list[dict[str, str]]) -> KVItem | None:
    """A two-column line with a short label is a header key-value pair."""
    if len(columns) != 2:
        return None
    label = columns[0]["text"].strip().rstrip(":：").strip()
    value = columns[1]["text"].strip()
    if not label or not value or len(label) > MAX_KV_LABEL_LEN:
        return None
    return KVItem(label, value)


def _columns_align(
    first: list[dict[str, str]], second: list[dict[str, str]], tolerance: float
) -> bool:
    if len(first) != len(second):
        return False
    return all(
        abs(a["left"] - b["left"]) <= tolerance
        for a, b in zip(first, second)
    )


def cluster_words(words: list[dict[str, Any]]) -> LayoutDocument:
    """Pure word-box clustering: lines -> columns -> KV items / table blocks."""
    keep = [word for word in words if _valid_word(word)]
    if not keep:
        return LayoutDocument()
    lines = _cluster_lines(keep)
    median_width = _median([int(w["width"]) for w in keep])
    gap_threshold = max(MIN_COL_GAP, COL_GAP_RATIO * median_width)

    line_columns = [_split_columns(line, gap_threshold) for line in lines]
    raw_lines: list[str] = []
    for line, columns in zip(lines, line_columns):
        raw_lines.append(" ".join(column["text"] for column in columns))

    kvs: list[KVItem] = []
    table_indices: list[int] = []
    for index, columns in enumerate(line_columns):
        kv = _kv_from_columns(columns)
        if kv is not None:
            kvs.append(kv)
        elif len(columns) >= 2:
            table_indices.append(index)

    tables = _group_table_lines(table_indices, line_columns, lines)
    return LayoutDocument(
        kvs=kvs, tables=tables, raw_text="\n".join(raw_lines)
    )


def _group_table_lines(
    indices: list[int],
    line_columns: list[list[dict[str, str]]],
    lines: list[dict[str, Any]],
) -> list[TableBlock]:
    """Group consecutive, column-aligned lines into TableBlocks."""
    from pdf_extract import _looks_like_header

    tables: list[TableBlock] = []
    run: list[int] = []
    heights = [max(1, line["bottom"] - line["top"]) for line in lines]
    block_gap = 1.5 * _median([float(h) for h in heights]) if heights else 0.0

    def flush() -> None:
        if len(run) < 2:
            return
        first = run[0]
        tolerance = max(8.0, 0.4 * _median(
            [
                float(c["right"] - c["left"])
                for index in run
                for c in line_columns[index]
            ]
        ))
        for prev, current in zip(run, run[1:]):
            if not _columns_align(
                line_columns[prev], line_columns[current], tolerance
            ):
                return
        cells = [[c["text"] for c in line_columns[index]] for index in run]
        headers = list(cells[0]) if _looks_like_header(cells[0]) else []
        data_rows = cells[1:] if headers else cells
        tables.append(TableBlock(name="表", headers=headers, rows=data_rows))

    previous = None
    for index in indices:
        if previous is not None:
            gap = lines[index]["top"] - lines[previous]["bottom"]
            if gap > block_gap or not run:
                flush()
                run = []
        run.append(index)
        previous = index
    flush()
    return tables


def extract_layout_from_image(image: Any) -> LayoutDocument:
    """OCR a preprocessed PIL image with tesseract word boxes -> LayoutDocument."""
    try:
        import pytesseract
    except ImportError as exc:
        raise ValueError(
            "pytesseract 未安装，本地 OCR 不可用。请执行 pip install "
            "'pytesseract>=0.3.13'。"
        ) from exc
    data = pytesseract.image_to_data(
        image, lang="chi_sim+eng", output_type=pytesseract.Output.DICT
    )
    words: list[dict[str, Any]] = []
    confs = data.get("conf") or []
    for index, text in enumerate(data.get("text") or []):
        words.append(
            {
                "left": data["left"][index],
                "top": data["top"][index],
                "width": data["width"][index],
                "height": data["height"][index],
                "conf": confs[index] if index < len(confs) else -1,
                "text": text,
            }
        )
    return cluster_words(words)


def _render_pdf_pages(data: bytes, dpi: int = 200) -> list[Any]:
    import pypdfium2 as pdfium

    pages: list[Any] = []
    pdf = pdfium.PdfDocument(BytesIO(data))
    try:
        for page in pdf:
            pages.append(page.render(scale=dpi / 72).to_pil())
    finally:
        pdf.close()
    return pages


def _kvs_from_text(text: str) -> list[KVItem]:
    """Regex key-value pairs (label: value) from plain text lines."""
    kvs: list[KVItem] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or "|" in line:
            continue
        match = re.match(r"^([^:：]{1,30}?)\s*[:：]\s*(.+)$", line)
        if not match:
            continue
        label = match.group(1).strip()
        value = match.group(2).strip()
        if label and value and len(label.split()) <= 3:
            kvs.append(KVItem(label, value))
    return kvs


def extract_layout_from_pdf(data: bytes) -> LayoutDocument:
    """Build a LayoutDocument from a PDF (text layer or scanned pages)."""
    from pdf_extract import (
        _looks_like_header,
        extract_pdf_tables,
        extract_pdf_text,
    )

    text = extract_pdf_text(data)
    rows, _count = extract_pdf_tables(data)
    if rows or (text and len(text.strip()) >= 10):
        layout = LayoutDocument(raw_text=text)
        layout.kvs = _kvs_from_text(text)
        if rows:
            headers = list(rows[0]) if _looks_like_header(rows[0]) else []
            data_rows = rows[1:] if headers else rows
            layout.tables.append(
                TableBlock(
                    name="表1",
                    headers=headers,
                    rows=[list(row) for row in data_rows],
                )
            )
        return layout

    layout = LayoutDocument()
    for image in _render_pdf_pages(data):
        page_layout = extract_layout_from_image(image)
        layout.kvs.extend(page_layout.kvs)
        layout.tables.extend(page_layout.tables)
        if page_layout.raw_text:
            layout.raw_text = (
                (layout.raw_text + "\n" + page_layout.raw_text).strip()
            )
    return layout


def _layout_from_markdown(text: str) -> LayoutDocument:
    """Parse markdown tables + KV lines from doc-parse output text."""
    kvs: list[KVItem] = []
    tables: list[TableBlock] = []
    current: TableBlock | None = None

    def close_table() -> None:
        nonlocal current
        if current is not None:
            tables.append(current)
            current = None

    for line in (text or "").splitlines():
        stripped = line.strip()
        if "|" in stripped:
            cells = [cell.strip() for cell in stripped.strip("|").split("|")]
            if all(re.fullmatch(r"[-: ]*", cell or "-") and cell.strip("-: ") == "" for cell in cells):
                continue  # markdown separator row (---|---)
            if current is None:
                current = TableBlock(name="表", headers=cells, rows=[])
            else:
                current.rows.append(cells)
            continue
        close_table()
        match = re.match(r"^([^:：]{1,30}?)\s*[:：]\s*(.+)$", stripped)
        if match:
            label = match.group(1).strip()
            value = match.group(2).strip()
            if label and value and len(label.split()) <= 3:
                kvs.append(KVItem(label, value))
    close_table()
    return LayoutDocument(kvs=kvs, tables=tables, raw_text=text)


def doc_parse_to_layout(payload: Any) -> LayoutDocument:
    """Consume a cloud doc-parse payload (markdown/JSON) into a LayoutDocument."""
    from pdf_extract import _longest_text

    if isinstance(payload, str):
        text = payload
    elif isinstance(payload, dict):
        text = _longest_text(payload) or ""
    else:
        text = str(payload or "")
    return _layout_from_markdown(text)
