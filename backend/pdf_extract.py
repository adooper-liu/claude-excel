"""pdf_extract.py — General local-first PDF extraction for text, tables, and scans."""

from __future__ import annotations

import os
import re
import shutil
import time
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
import pdfplumber
import pypdfium2 as pdfium
from pypdf import PdfReader

from config_store import get_config

TEXT_MIN_LEN = 40
OCR_DPI = 200
MAX_CLOUD_TASK_SECONDS = 120
DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/api/v1"


def detect_kind(text_len: int, table_count: int) -> str:
    """Classify by structured table first, then text, then scanned."""
    if table_count > 0:
        return "table"
    if text_len >= TEXT_MIN_LEN:
        return "text"
    return "scanned"


def extract_pdf_text(data: bytes) -> str:
    reader = PdfReader(BytesIO(data))
    pages: list[str] = []
    for page in reader.pages:
        page_text = str(page.extract_text() or "").strip()
        if page_text:
            pages.append(page_text)
    return "\n\n".join(pages)


def count_pdf_pages(data: bytes) -> int:
    return len(PdfReader(BytesIO(data)).pages)


_TABLE_SETTINGS = {"vertical_strategy": "text", "horizontal_strategy": "lines"}


def extract_pdf_tables(data: bytes) -> tuple[list[list[str]] | None, int]:
    """Return the largest table (header inferred, empty columns dropped) and the table count.

    vertical_strategy="text" clusters columns from word x-positions, so borderless
    tables (invoices, statements) are captured too — not just line-ruled ones.
    """
    best: list[list[str]] | None = None
    best_size = 0
    table_count = 0
    with pdfplumber.open(BytesIO(data)) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            for table in page.find_tables(table_settings=_TABLE_SETTINGS):
                rows = _drop_empty_columns(_normalize_table(table.extract()))
                if not rows:
                    continue
                table_count += 1
                size = len(rows) * max(len(row) for row in rows)
                if size <= best_size:
                    continue
                best = _with_inferred_header(rows, table, words)
                best_size = size
    if best and len(best) >= 2 and best[0] == best[1]:
        best.pop(0)
    return best, table_count


def _drop_empty_columns(rows: list[list[str]]) -> list[list[str]]:
    """Remove columns that are empty across all rows."""
    if not rows:
        return rows
    width = max(len(row) for row in rows)
    keep = [c for c in range(width) if any(c < len(r) and r[c].strip() for r in rows)]
    return [[row[c] for c in keep] for row in rows]


def _is_numeric(text: str) -> bool:
    t = str(text or "").strip().replace(",", "").replace("￥", "").replace("¥", "").replace("%", "")
    if not t:
        return False
    try:
        float(t)
        return True
    except ValueError:
        return False


def _looks_like_header(row: list[str]) -> bool:
    """True if every non-empty cell is text (no numeric cell) — a header row."""
    non_empty = [c for c in row if c.strip()]
    return bool(non_empty) and all(not _is_numeric(c) for c in non_empty)


def _with_inferred_header(
    rows: list[list[str]], table: Any, words: list[dict[str, Any]]
) -> list[list[str]]:
    """If the first row is all-numeric (data, no header), lift a header from above the table."""
    if not rows or _looks_like_header(rows[0]):
        return rows
    header = _header_row_above(table, words)
    return ([header] + rows) if header else rows


def _header_row_above(table: Any, words: list[dict[str, Any]], tol: float = 20.0) -> list[str] | None:
    """Collect words just above the table's top edge, deduped and x-sorted, as a header row."""
    bbox = getattr(table, "bbox", None)
    if not bbox:
        return None
    top = float(bbox[1])
    near = [w for w in words if float(w["bottom"]) <= top and top - float(w["bottom"]) <= tol]
    if not near:
        return None
    near.sort(key=lambda w: (float(w["x0"]), -float(w["top"])))
    header: list[str] = []
    for w in near:
        t = str(w.get("text", "")).strip()
        if t and (not header or header[-1] != t):
            header.append(t)
    return header or None


_TESSERACT_WIN_PATHS = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
)


def _find_tesseract() -> str | None:
    """PATH first, then common Windows install dirs (UB-Mannheim does not touch PATH)."""
    found = shutil.which("tesseract")
    if found:
        return found
    for candidate in _TESSERACT_WIN_PATHS:
        if os.path.isfile(candidate):
            return candidate
    return None


def extract_pdf_ocr_local(data: bytes) -> str:
    tesseract_cmd = _find_tesseract()
    if tesseract_cmd is None:
        raise ValueError(
            "未安装 tesseract 二进制，本地 OCR 不可用。install.bat 会安装 "
            "UB-Mannheim.TesseractOCR（含 chi_sim）。"
        )
    try:
        import pytesseract
    except ImportError as exc:
        raise ValueError(
            "pytesseract 未安装，本地 OCR 不可用。请执行 "
            "pip install 'pytesseract>=0.3.13'。"
        ) from exc
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    parts: list[str] = []
    pdf = pdfium.PdfDocument(BytesIO(data))
    try:
        for page in pdf:
            image = page.render(scale=OCR_DPI / 72).to_pil()
            text = pytesseract.image_to_string(image, lang="chi_sim+eng")
            text = str(text or "").replace("\x0c", "\n").strip()
            if text:
                parts.append(text)
    finally:
        pdf.close()
    return "\n\n".join(parts)


def extract_pdf_ocr_cloud(data: bytes, filename: str = "upload.pdf") -> str:
    """Parse a local PDF with Bailian doc-parse after explicit upstream consent."""
    api_key = _dashscope_api_key()
    if not api_key:
        raise ValueError(
            "云 OCR 缺少凭证：请设置 DASHSCOPE_API_KEY，或在 config.json 的 "
            "providers.qwen.apiKey 中配置百炼 API Key。"
        )

    auth = {"Authorization": "Bearer " + api_key}
    try:
        with httpx.Client(timeout=60) as client:
            upload = client.post(
                DASHSCOPE_BASE + "/uploads",
                headers={**auth, "X-DashScope-Async": "enable"},
                files={"file": (filename, data, "application/pdf")},
            )
            _raise_dashscope_error(upload, "上传 PDF")
            oss_url = _response_field(upload.json(), ("oss_url", "ossUrl", "url", "file_url", "fileUrl"))
            file_id = _response_field(upload.json(), ("file_id", "fileId"))
            if not oss_url and not file_id:
                raise ValueError("百炼上传接口未返回 oss_url/file_id，无法提交 doc-parse。")

            submit = client.post(
                DASHSCOPE_BASE + "/services/doc_parse/doc-parse",
                headers={**auth, "X-DashScope-Async": "enable"},
                json={
                    "model": "doc-parse",
                    "input": {"file_url": oss_url} if oss_url else {"file_id": file_id},
                    "parameters": {"language": "ch", "enable_table": True},
                },
            )
            _raise_dashscope_error(submit, "提交 doc-parse")
            task_id = _response_field(
                submit.json(), ("task_id", "taskId"),
            )
            if not task_id:
                raise ValueError("百炼 doc-parse 未返回 task_id。")

            deadline = time.monotonic() + MAX_CLOUD_TASK_SECONDS
            while time.monotonic() < deadline:
                poll = client.get(DASHSCOPE_BASE + "/tasks/" + str(task_id), headers=auth)
                _raise_dashscope_error(poll, "查询 doc-parse 任务")
                payload = poll.json()
                status = str(_response_field(payload, ("task_status", "taskStatus")) or "").upper()
                if status == "SUCCEEDED":
                    result_url = _doc_parse_result_url(payload)
                    if result_url:
                        result = client.get(result_url)
                        _raise_dashscope_error(result, "下载 doc-parse 结果")
                    else:
                        result = poll
                    return _doc_parse_text(result)
                if status in ("FAILED", "CANCELED", "UNKNOWN"):
                    message = _response_field(
                        payload, ("message", "error_message", "errorMessage")
                    )
                    raise ValueError("百炼 doc-parse 任务失败：" + str(message or status))
                if status not in ("PENDING", "RUNNING", ""):
                    raise ValueError("百炼 doc-parse 返回未知状态：" + status)
                time.sleep(1)
            raise ValueError("百炼 doc-parse 任务超时，请稍后重试。")
    except httpx.HTTPError as exc:
        raise ValueError("云 OCR 请求失败：" + str(exc)) from exc


_IMAGE_MAGIC = (
    b"\x89PNG\r\n\x1a\n",  # PNG
    b"\xff\xd8\xff",       # JPEG
    b"II*\x00",            # TIFF little-endian
    b"MM\x00*",            # TIFF big-endian
    b"BM",                 # BMP
)


def _is_image(data: bytes) -> bool:
    return any(data.startswith(magic) for magic in _IMAGE_MAGIC)


def extract_image_ocr_local(data: bytes) -> str:
    tesseract_cmd = _find_tesseract()
    if tesseract_cmd is None:
        raise ValueError(
            "未安装 tesseract 二进制，本地 OCR 不可用。install.bat 会安装 "
            "UB-Mannheim.TesseractOCR（含 chi_sim）。"
        )
    try:
        import pytesseract
        from PIL import Image
    except ImportError as exc:
        raise ValueError("pytesseract/Pillow 未安装，本地 OCR 不可用。") from exc
    pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
    image = Image.open(BytesIO(data))
    text = pytesseract.image_to_string(image, lang="chi_sim+eng")
    return str(text or "").replace("\x0c", "\n").strip()


def extract_pdf(
    data: bytes,
    ocr_backend: str = "local",
    filename: str = "upload.pdf",
) -> dict[str, Any]:
    backend = (ocr_backend or "local").strip().lower()
    if backend not in ("local", "cloud"):
        return _result(
            kind="scanned", backend=None, filename=filename,
            error="ocrBackend 仅支持 local 或 cloud",
        )
    is_pdf = data.startswith(b"%PDF-")
    is_image = _is_image(data)
    if not is_pdf and not is_image:
        return _result(
            kind="scanned", backend=None, filename=filename,
            error="仅支持 PDF 或图片（PNG/JPG/TIFF/BMP）文件",
        )

    page_count = 0
    try:
        if is_image:
            ocr_text = (
                extract_image_ocr_local(data)
                if backend == "local"
                else extract_pdf_ocr_cloud(data, filename)
            )
            ocr_rows = _rows_from_ocr_text(ocr_text)
            if ocr_rows:
                return _result(
                    kind="table", backend=backend, filename=filename,
                    rows=ocr_rows, tables=0, text=ocr_text, pages=1,
                )
            return _result(
                kind="text", backend=backend, filename=filename,
                text=ocr_text, pages=1,
            )

        page_count = count_pdf_pages(data)
        text = extract_pdf_text(data)
        rows, table_count = extract_pdf_tables(data)
        kind = detect_kind(len(text), table_count)
        if kind == "text":
            return _result(
                kind="text", backend=None, filename=filename,
                text=text, pages=page_count,
            )
        if kind == "table":
            return _result(
                kind="table", backend=None, filename=filename,
                text=text, rows=rows, tables=table_count, pages=page_count,
            )

        if backend == "local":
            ocr_text = extract_pdf_ocr_local(data)
        else:
            ocr_text = extract_pdf_ocr_cloud(data, filename)
        ocr_rows = _rows_from_ocr_text(ocr_text)
        if ocr_rows:
            return _result(
                kind="table", backend=backend, filename=filename,
                rows=ocr_rows, tables=table_count, text=ocr_text,
                pages=page_count,
            )
        return _result(
            kind="text", backend=backend, filename=filename,
            text=ocr_text, pages=page_count,
        )
    except ValueError as exc:
        return _result(
            kind="scanned", backend=backend if backend == "cloud" else None,
            filename=filename, pages=page_count, error=str(exc),
        )
    except Exception as exc:
        return _result(
            kind="scanned", backend=backend if backend == "cloud" else None,
            filename=filename, pages=page_count,
            error="PDF 解析失败：" + str(exc),
        )


def _normalize_table(raw: list[list[Any]]) -> list[list[str]]:
    rows: list[list[str]] = []
    for raw_row in raw or []:
        row = ["" if cell is None else str(cell) for cell in raw_row or []]
        # Drop summary/merged rows: a clean data cell never contains a line break.
        if any(cell.strip() for cell in row) and not any("\n" in cell for cell in row):
            rows.append(row)
    width = max((len(row) for row in rows), default=0)
    return [row + [""] * (width - len(row)) for row in rows]


def _rows_from_ocr_text(text: str) -> list[list[str]] | None:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    rows: list[list[str]] = []
    for line in lines:
        if "|" in line:
            cells = [cell.strip() for cell in line.strip("|").split("|")]
        elif "\t" in line:
            cells = [cell.strip() for cell in line.split("\t")]
        elif re.search(r"\S\s{2,}\S", line):
            cells = [cell.strip() for cell in re.split(r"\s{2,}", line)]
        else:
            continue
        if len(cells) > 1 and any(cells):
            rows.append(cells)
    if len(rows) < 2:
        return None
    if len(rows) >= 2 and rows[0] == rows[1]:
        rows.pop(0)
    return rows


def _result(
    *,
    kind: str,
    backend: str | None,
    filename: str,
    text: str | None = None,
    rows: list[list[str]] | None = None,
    tables: int = 0,
    pages: int = 0,
    error: str | None = None,
) -> dict[str, Any]:
    content = text or (rows[0][0] if rows and rows[0] and rows[0][0] else "")
    return {
        "kind": kind,
        "text": text,
        "rows": rows,
        "tables": tables,
        "pages": pages,
        "ocrBackend": backend,
        "sheetName": _sheet_name(filename),
        "preview": content[:200],
        "error": error,
    }


def _sheet_name(filename: str) -> str:
    stem = Path(filename or "upload.pdf").stem or "PDF"
    safe = re.sub(r"[\\/:*?\"<>|\[\]\r\n\t]+", "_", stem).strip(" ._") or "PDF"
    return safe[:28]


def _dashscope_api_key() -> str:
    return (
        os.getenv("DASHSCOPE_API_KEY")
        or os.getenv("BAILIAN_API_KEY")
        or str(
            ((get_config().get("providers") or {}).get("qwen") or {}).get("apiKey") or ""
        )
    )


def _response_field(payload: Any, names: tuple[str, ...]) -> Any:
    if not isinstance(payload, dict):
        return None
    scopes: list[Any] = [payload]
    for key in ("data", "output"):
        value = payload.get(key)
        if isinstance(value, dict):
            scopes.append(value)
    for scope in scopes:
        for name in names:
            if scope.get(name) is not None:
                return scope[name]
    return None


def _raise_dashscope_error(response: httpx.Response, action: str) -> None:
    if response.is_success:
        return
    try:
        payload = response.json()
        message = _response_field(payload, ("message", "error_message", "errorMessage"))
        if not message:
            message = str(payload)
    except ValueError:
        message = response.text
    raise ValueError(f"百炼 {action}失败（HTTP {response.status_code}）：{message}")


def _doc_parse_result_url(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    output = payload.get("output") if isinstance(payload.get("output"), dict) else payload
    results = output.get("results") or output.get("result") or output.get("output")
    if isinstance(results, list):
        for item in results:
            if isinstance(item, str) and item.startswith(("http://", "https://")):
                return item
            url = _response_field(item, ("url", "result_url", "resultUrl"))
            if url:
                return str(url)
    elif isinstance(results, dict):
        url = _response_field(results, ("url", "result_url", "resultUrl"))
        if url:
            return str(url)
    return None


def _doc_parse_text(response: httpx.Response) -> str:
    content_type = response.headers.get("content-type", "")
    raw = response.text
    if "json" in content_type or raw.lstrip().startswith(("{", "[")):
        try:
            payload = response.json()
        except ValueError:
            payload = raw
        text = _longest_text(payload)
        if text:
            return text
    if raw.strip():
        return raw
    raise ValueError("百炼 doc-parse 成功，但未返回可读文本。")


def _longest_text(payload: Any) -> str | None:
    preferred = (
        "markdown", "md", "doc_text", "docText", "text", "content",
        "ocr_result", "ocrResult", "result",
    )
    candidates: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for key in preferred:
                item = value.get(key)
                if isinstance(item, str):
                    candidates.append(item)
                elif item is not None:
                    visit(item)
            for item in value.values():
                visit(item)
        elif isinstance(value, list):
            for item in value:
                visit(item)
        elif isinstance(value, str):
            candidates.append(value)

    visit(payload)
    return max(candidates, key=len, default=None)
