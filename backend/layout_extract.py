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
from html.parser import HTMLParser
from io import BytesIO
from typing import Any

from layout_doc import KVItem, LayoutDocument, TableBlock, normalize_key

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


def _extract_layout_tesseract(image: Any) -> LayoutDocument:
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


def extract_layout_from_image(image: Any) -> LayoutDocument:
    """OCR a preprocessed PIL image -> LayoutDocument.

    Uses the RapidStruct path (layout regions + table HTML) when the optional
    ``rapid_layout`` / ``rapid_table`` / ``rapidocr`` packages are installed;
    any rapid failure silently falls back to the tesseract word-box path so
    the Task 1-9 flow is never broken.
    """
    if _rapid_available():
        try:
            return extract_layout_from_image_rapid(image)
        except Exception:
            pass
    return _extract_layout_tesseract(image)


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

# ---------------------------------------------------------------------------
# RapidStruct path (Task 10): layout regions + table HTML -> LayoutDocument.
# Optional deps (rapid_layout / rapid_table / rapidocr).  Any failure silently
# falls back to the tesseract word-box path above.
# ---------------------------------------------------------------------------

#: Packages that must all be importable for the rapid path to be used.
RAPID_PACKAGES = ("rapid_layout", "rapid_table", "rapidocr")

#: Layout class names treated as table regions (EN + ZH).
TABLE_REGION_LABELS = {"table", "\u8868\u683c"}

#: Layout class names whose OCR text never holds header KVs (figures/stamps).
NON_TEXT_REGION_LABELS = {
    "figure", "figure_caption", "image", "picture", "logo", "stamp", "seal",
    "formula", "equation", "table_caption",
    "\u56fe", "\u56fe\u7247", "\u56fe\u7247\u6807\u9898", "\u5370\u7ae0",
    "\u8868\u683c\u6807\u9898", "\u516c\u5f0f",
}


def _rapid_available() -> bool:
    """True when every optional RapidStruct package is importable."""
    import importlib.util

    try:
        return all(
            importlib.util.find_spec(pkg) is not None for pkg in RAPID_PACKAGES
        )
    except (ImportError, ValueError):
        return False


def _rapid_engines() -> tuple[Any, Any, Any]:
    """Instantiate RapidLayout / RapidTable / RapidOCR (lazy, optional deps)."""
    from rapid_layout import RapidLayout
    from rapid_table import RapidTable
    from rapidocr import RapidOCR

    return RapidLayout(), RapidTable(), RapidOCR()


def _attr(result: Any, name: str) -> Any:
    """Read a field from a dataclass-like or dict-like rapid result."""
    if isinstance(result, dict):
        return result.get(name)
    return getattr(result, name, None)


def _is_table_region(label: Any) -> bool:
    key = normalize_key(label)
    return key in {normalize_key(item) for item in TABLE_REGION_LABELS}


def _is_text_region(label: Any) -> bool:
    """Anything that is not a table/figure region is a KV text candidate."""
    key = normalize_key(label)
    if key in {normalize_key(item) for item in TABLE_REGION_LABELS}:
        return False
    if key in {normalize_key(item) for item in NON_TEXT_REGION_LABELS}:
        return False
    return True


def _quad_bbox(box: Any) -> tuple[float, float, float, float]:
    """Axis-aligned bbox (x1, y1, x2, y2) of a 4-point quad OCR box."""
    points = [p for p in (box or []) if p is not None]
    if not points:
        return (0.0, 0.0, 0.0, 0.0)
    xs = [float(p[0]) for p in points]
    ys = [float(p[1]) for p in points]
    return min(xs), min(ys), max(xs), max(ys)


def _box_overlap(
    a: tuple[float, float, float, float],
    b: tuple[float, float, float, float],
    min_ratio: float = 0.3,
) -> bool:
    """True when box ``b`` overlaps box ``a`` by at least ``min_ratio`` of b."""
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    ix = min(ax2, bx2) - max(ax1, bx1)
    iy = min(ay2, by2) - max(ay1, by1)
    if ix <= 0 or iy <= 0:
        return False
    area = max(1.0, (bx2 - bx1) * (by2 - by1))
    return (ix * iy) / area >= min_ratio


def _group_ocr_lines(
    ocr_boxes: list[Any],
    ocr_txts: list[str],
    ocr_scores: list[Any],
    region: tuple[float, float, float, float] | None = None,
) -> list[str]:
    """Group OCR boxes (optionally inside a region) into text lines."""
    items: list[tuple[float, float, float, float, str]] = []
    for box, txt in zip(ocr_boxes, ocr_txts):
        text = str(txt or "").strip()
        if not text:
            continue
        bbox = _quad_bbox(box)
        if region is not None and not _box_overlap(region, bbox):
            continue
        items.append((bbox[0], bbox[1], bbox[2], bbox[3], text))
    words = [
        {
            "left": x1,
            "top": y1,
            "width": max(1.0, x2 - x1),
            "height": max(1.0, y2 - y1),
            "conf": -1,
            "text": text,
        }
        for x1, y1, x2, y2, text in items
    ]
    lines = _cluster_lines(words)
    return [" ".join(w["text"] for w in line["words"]) for line in lines]


class _TableHtmlParser(HTMLParser):
    """Minimal <table> parser -> rows of cells (colspan expanded)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._colspan = 1

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag == "tr":
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
            self._colspan = 1
            for key, value in attrs:
                if key.lower() == "colspan" and value and value.isdigit():
                    self._colspan = max(1, int(value))

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            text = "".join(self._cell).strip()
            self._row.extend([text] * self._colspan)
            self._cell = None
            self._colspan = 1
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None


def _is_separator_row(row: list[str]) -> bool:
    """True for markdown-style separator rows (e.g. |---|---|)."""
    non_empty = [c for c in row if c.strip()]
    if not non_empty:
        return True
    return all(set(c.strip()) <= set("-: ") for c in non_empty)


def _table_from_html(html: str, name: str = "\u8868") -> TableBlock:
    """Parse a RapidTable HTML string into a TableBlock (never raises)."""
    from pdf_extract import _looks_like_header

    parser = _TableHtmlParser()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:
        return TableBlock(name=name)
    rows = [row for row in parser.rows if not _is_separator_row(row)]
    if not rows:
        return TableBlock(name=name)
    headers = list(rows[0]) if _looks_like_header(rows[0]) else []
    data_rows = rows[1:] if headers else rows
    return TableBlock(name=name, headers=headers, rows=data_rows)


def _rapid_table_block(
    image: Any, table_engine: Any, region: tuple[float, float, float, float], index: int
) -> TableBlock | None:
    """Run RapidTable on a cropped table region -> TableBlock or None."""
    try:
        crop = image.crop(
            (int(region[0]), int(region[1]), int(region[2]), int(region[3]))
        )
    except Exception:
        crop = image
    try:
        result = table_engine(crop)
    except Exception:
        return None
    htmls = list(_attr(result, "pred_htmls") or [])
    if not htmls:
        return None
    table = _table_from_html(str(htmls[0]), name=f"\u8868{index + 1}")
    if not table.headers and not table.rows:
        return None
    return table


def _layout_from_rapid(
    image: Any, layout_engine: Any, table_engine: Any, ocr_engine: Any
) -> LayoutDocument:
    """Run layout regions + table HTML + OCR text through LayoutDocument."""
    layout_result = layout_engine(image)
    boxes = list(_attr(layout_result, "boxes") or [])
    class_names = list(_attr(layout_result, "class_names") or [])
    if not boxes or len(boxes) != len(class_names):
        raise ValueError("RapidLayout returned no usable regions")

    ocr_result = ocr_engine(image)
    ocr_boxes = (
        list(_attr(ocr_result, "boxes") or []) if ocr_result is not None else []
    )
    ocr_txts = (
        list(_attr(ocr_result, "txts") or []) if ocr_result is not None else []
    )
    ocr_scores = (
        list(_attr(ocr_result, "scores") or []) if ocr_result is not None else []
    )

    kvs: list[KVItem] = []
    for box, label in zip(boxes, class_names):
        if not _is_text_region(label):
            continue
        region = tuple(float(v) for v in box[:4])  # type: ignore[index]
        lines = _group_ocr_lines(ocr_boxes, ocr_txts, ocr_scores, region)
        kvs.extend(_kvs_from_text("\n".join(lines)))

    tables: list[TableBlock] = []
    for index, (box, label) in enumerate(zip(boxes, class_names)):
        if not _is_table_region(label):
            continue
        region = tuple(float(v) for v in box[:4])  # type: ignore[index]
        table = _rapid_table_block(image, table_engine, region, index)
        if table is not None:
            tables.append(table)

    raw_text = "\n".join(_group_ocr_lines(ocr_boxes, ocr_txts, ocr_scores))
    return LayoutDocument(kvs=kvs, tables=tables, raw_text=raw_text)


def extract_layout_from_image_rapid(image: Any) -> LayoutDocument:
    """RapidStruct layout + table recognition -> LayoutDocument.

    Falls back to the tesseract word-box path on any rapid failure so callers
    never see a broken layout when the optional models are unavailable.
    """
    try:
        layout_engine, table_engine, ocr_engine = _rapid_engines()
        return _layout_from_rapid(
            image, layout_engine, table_engine, ocr_engine
        )
    except Exception:
        return _extract_layout_tesseract(image)
