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


def test_is_numeric():
    assert pdf_extract._is_numeric("123")
    assert pdf_extract._is_numeric("1,234.5")
    assert pdf_extract._is_numeric("￥50")
    assert pdf_extract._is_numeric("12%")
    assert not pdf_extract._is_numeric("")
    assert not pdf_extract._is_numeric("品名")


def test_looks_like_header():
    assert not pdf_extract._looks_like_header(["1", "2", "3"])
    assert pdf_extract._looks_like_header(["品名", "数量", "单价"])
    assert not pdf_extract._looks_like_header(["1", "品名", "3"])
    assert not pdf_extract._looks_like_header(["网页设计", "$50.00", "50", "$2500.00"])


def test_with_inferred_header_lifts_header_above_table():
    class T:
        bbox = (0, 100, 300, 200)

    words = [
        {"x0": 10, "top": 90, "bottom": 99, "text": "品名"},
        {"x0": 100, "top": 90, "bottom": 99, "text": "数量"},
        {"x0": 200, "top": 90, "bottom": 99, "text": "单价"},
    ]
    rows = [["1", "2", "3"], ["4", "5", "6"]]
    out = pdf_extract._with_inferred_header(rows, T(), words)
    assert out[0] == ["品名", "数量", "单价"]
    assert out[1] == ["1", "2", "3"]


def test_with_inferred_header_keeps_existing_header():
    rows = [["品名", "数量", "单价"], ["A", "1", "2"]]
    out = pdf_extract._with_inferred_header(rows, object(), [])
    assert out == rows


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


def test_local_image_preprocesses_once(monkeypatch):
    from io import BytesIO

    from layout_doc import LayoutDocument
    from PIL import Image

    buffer = BytesIO()
    Image.new("L", (32, 32), 255).save(buffer, "PNG")
    png = buffer.getvalue()

    calls = {"n": 0}
    real_preprocess = pdf_extract.preprocess_image

    def counting(data):
        calls["n"] += 1
        return real_preprocess(data)

    monkeypatch.setattr(pdf_extract, "preprocess_image", counting)
    monkeypatch.setattr(
        pdf_extract, "extract_layout_from_image", lambda image: LayoutDocument()
    )
    monkeypatch.setattr(
        pdf_extract,
        "extract_image_ocr_local",
        lambda data, image=None: "Item\tAmount\nWidget\t1,234.56",
    )
    result = pdf_extract.extract_pdf(png, ocr_backend="local", filename="invoice.png")
    assert result["kind"] == "table"
    assert calls["n"] == 1


def test_proposed_recipe_falls_back_to_flat_rows_when_layout_empty(monkeypatch):
    from layout_doc import LayoutDocument

    monkeypatch.setattr(pdf_extract, "preprocess_image", lambda data: object())
    monkeypatch.setattr(
        pdf_extract, "extract_layout_from_image", lambda image: LayoutDocument()
    )
    monkeypatch.setattr(
        pdf_extract,
        "extract_image_ocr_local",
        lambda data, image=None: "Item\tAmount\nWidget\t1,234.56",
    )
    result = pdf_extract.extract_pdf(
        b"\x89PNG\r\n\x1a\nxxxx", ocr_backend="local", filename="invoice.png"
    )
    assert result["kind"] == "table"
    assert result["proposedRecipe"] is not None
    fields = result["proposedRecipe"]["fields"]
    assert fields[0]["source"] == "Item"
    assert fields[1]["type"] == "number"


def test_proposed_recipe_falls_back_when_layout_extraction_raises(monkeypatch):
    def boom(_image):
        raise RuntimeError("no layout")

    monkeypatch.setattr(pdf_extract, "preprocess_image", lambda data: object())
    monkeypatch.setattr(pdf_extract, "extract_layout_from_image", boom)
    monkeypatch.setattr(
        pdf_extract,
        "extract_image_ocr_local",
        lambda data, image=None: "Item\tAmount\nWidget\t1,234.56",
    )
    result = pdf_extract.extract_pdf(
        b"\x89PNG\r\n\x1a\nxxxx", ocr_backend="local", filename="invoice.png"
    )
    assert result["proposedRecipe"] is not None
    assert result["proposedRecipe"]["fields"][0]["source"] == "Item"


def test_extract_pdf_applies_table_template_only_when_provided(monkeypatch):
    template = {
        "fields": [
            {"name": "名称", "type": "text"},
            {
                "name": "金额",
                "type": "number",
                "format": {"numberStyle": "eu", "stripSymbols": ["€"]},
            },
        ]
    }
    source_rows = [["Old", "Old"], ["Widget", "€1.234,56"]]
    monkeypatch.setattr(pdf_extract, "count_pdf_pages", lambda _data: 1)
    monkeypatch.setattr(pdf_extract, "extract_pdf_text", lambda _data: "extracted text")
    monkeypatch.setattr(
        pdf_extract,
        "extract_pdf_tables",
        lambda _data: (source_rows, 1),
    )

    cleaned = pdf_extract.extract_pdf(b"%PDF-", template=template)
    assert cleaned["rows"] == [["名称", "金额"], ["Widget", 1234.56]]

    untouched = pdf_extract.extract_pdf(b"%PDF-")
    assert untouched["rows"] == source_rows


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


def test_image_ocr_uses_rapid_layout_text_and_rows(monkeypatch):
    """When the rapid layout succeeds, the shown text is RapidOCR output and the
    worksheet rows come from the layout detail table (RapidOCR text is one
    field per line, so legacy _rows_from_ocr_text finds no rows)."""
    from layout_doc import KVItem, LayoutDocument, TableBlock

    layout = LayoutDocument(
        kvs=[KVItem("发票号码", "12345678")],
        tables=[
            TableBlock(
                name="表",
                headers=["品名", "金额"],
                rows=[["A", "1.5"]],
            )
        ],
        raw_text="发票号码: 12345678\n品名 金额\nA 1.5",
        engine="rapid",
    )
    monkeypatch.setattr(pdf_extract, "preprocess_image", lambda data: object())
    monkeypatch.setattr(pdf_extract, "extract_layout_from_image", lambda image: layout)

    def boom(*args, **kwargs):
        raise AssertionError("tesseract text must not run when rapid layout works")

    monkeypatch.setattr(pdf_extract, "extract_image_ocr_local", boom)
    result = pdf_extract.extract_pdf(
        b"\x89PNG\r\n\x1a\nxxxx", ocr_backend="local", filename="invoice.png"
    )
    assert result["kind"] == "table"
    assert result["text"] == "发票号码: 12345678\n品名 金额\nA 1.5"
    assert result["rows"] == [["品名", "金额"], ["A", "1.5"]]
