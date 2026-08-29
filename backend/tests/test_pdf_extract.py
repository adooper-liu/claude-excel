"""PDF extraction classifier, extractor, OCR fallbacks, and API authorization gate."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import pdf_extract  # noqa: E402


def _text_pdf(text: str) -> bytes:
    content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(content)).encode("ascii")
        + b" >>\nstream\n" + content + b"\nendstream",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, body in enumerate(objects, 1):
        offsets.append(len(out))
        out.extend(str(number).encode("ascii") + b" 0 obj\n" + body + b"\nendobj\n")
    xref = len(out)
    out.extend(b"xref\n0 6\n0000000000 65535 f \n")
    for offset in offsets[1:]:
        out.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    out.extend(
        b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"
        + str(xref).encode("ascii")
        + b"\n%%EOF\n"
    )
    return bytes(out)


def test_detect_kind_uses_table_then_text_then_scanned():
    assert pdf_extract.detect_kind(pdf_extract.TEXT_MIN_LEN, 0) == "text"
    assert pdf_extract.detect_kind(pdf_extract.TEXT_MIN_LEN - 1, 2) == "table"
    assert pdf_extract.detect_kind(pdf_extract.TEXT_MIN_LEN, 2) == "table"
    assert pdf_extract.detect_kind(0, 0) == "scanned"


def test_is_image_magic_bytes():
    assert pdf_extract._is_image(b"\x89PNG\r\n\x1a\nxxxx")
    assert pdf_extract._is_image(b"\xff\xd8\xff\xe0xxxx")
    assert pdf_extract._is_image(b"II*\x00xxxx")
    assert not pdf_extract._is_image(b"%PDF-1.4")
    assert not pdf_extract._is_image(b"not-an-image")


def test_extract_pdf_text_layer():
    result = pdf_extract.extract_pdf(
        _text_pdf("This is a plain PDF text layer for SheetWise."),
        filename="text report.pdf",
    )
    assert result["kind"] == "text"
    assert result["pages"] == 1
    assert "plain PDF text layer" in result["text"]
    assert result["sheetName"] == "text report"
    assert result["preview"].startswith("This is")


def test_scanned_pdf_local_missing_tesseract_returns_readable_error(monkeypatch):
    monkeypatch.setattr(pdf_extract, "_find_tesseract", lambda: None)
    result = pdf_extract.extract_pdf(_text_pdf(""), filename="scan.pdf", ocr_backend="local")
    assert result["kind"] == "scanned"
    assert "tesseract" in result["error"]
    assert "install.bat" in result["error"]


def test_ocr_text_with_aligned_columns_becomes_rows():
    rows = pdf_extract._rows_from_ocr_text(
        "Name  Amount\nApple  12\nBanana  30"
    )
    assert rows == [["Name", "Amount"], ["Apple", "12"], ["Banana", "30"]]


def test_cloud_ocr_without_key_is_readable(monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("BAILIAN_API_KEY", raising=False)
    monkeypatch.setattr(
        pdf_extract,
        "get_config",
        lambda: {"providers": {"qwen": {"apiKey": ""}}},
    )
    with pytest.raises(ValueError, match="云 OCR 缺少凭证"):
        pdf_extract.extract_pdf_ocr_cloud(b"%PDF-", "scan.pdf")


def test_doc_parse_text_prefers_markdown():
    text = pdf_extract._longest_text(
        {"output": {"result": {"markdown": "# Invoice\n\nAmount | Total", "raw": "x"}}}
    )
    assert text.startswith("# Invoice")
