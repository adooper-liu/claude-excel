"""API behavior for document templates and template-aware extraction."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

import pdf_extract  # noqa: E402
import server  # noqa: E402


def _client(monkeypatch) -> TestClient:
    monkeypatch.setattr(server, "require_loopback", lambda _request: None)
    return TestClient(server.app)


def _template() -> dict:
    return {
        "name": "增值税发票",
        "description": "invoice",
        "fields": [{"name": "金额", "type": "number"}],
    }


def test_doc_recipe_list_create_delete(monkeypatch):
    saved = {}

    def fake_save(raw, *, original_name="", sample_data=None, sample_filename=""):
        saved.update(
            raw=raw,
            original_name=original_name,
            sample_data=sample_data,
            sample_filename=sample_filename,
        )
        return dict(raw)

    monkeypatch.setattr(server, "list_doc_recipes", lambda: [{"name": "增值税发票"}])
    monkeypatch.setattr(server, "save_doc_recipe", fake_save)
    monkeypatch.setattr(server, "delete_doc_recipe", lambda name: saved.setdefault("deleted", name))
    client = _client(monkeypatch)

    response = client.get("/api/doc-recipes")
    assert response.status_code == 200
    assert response.json() == {"recipes": [{"name": "增值税发票"}]}

    response = client.post(
        "/api/doc-recipes",
        data={"template": json.dumps(_template(), ensure_ascii=False)},
        files={"sample": ("invoice.pdf", b"%PDF-sample", "application/pdf")},
    )
    assert response.status_code == 200
    assert response.json() == _template()
    assert saved["sample_data"] == b"%PDF-sample"
    assert saved["sample_filename"] == "invoice.pdf"

    response = client.delete("/api/doc-recipes/%E5%A2%9E%E5%80%BC%E7%A8%8E%E5%8F%91%E7%A5%A8")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert saved["deleted"] == "增值税发票"


def test_doc_recipe_api_get_detail(monkeypatch):
    monkeypatch.setattr(server, "load_doc_recipe", lambda name: {"name": name, "fields": []})
    client = _client(monkeypatch)
    response = client.get("/api/doc-recipes/%E5%A2%9E%E5%80%BC%E7%A8%8E%E5%8F%91%E7%A5%A8")
    assert response.status_code == 200
    assert response.json() == {"name": "增值税发票", "fields": []}


def test_doc_recipe_api_maps_storage_errors(monkeypatch):
    monkeypatch.setattr(server, "save_doc_recipe", lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("name 必填")))
    monkeypatch.setattr(server, "delete_doc_recipe", lambda *_args: (_ for _ in ()).throw(FileNotFoundError("模板不存在")))
    client = _client(monkeypatch)

    created = client.post("/api/doc-recipes", data={"template": "{}"})
    assert created.status_code == 400
    assert created.json()["detail"] == "name 必填"

    deleted = client.delete("/api/doc-recipes/missing")
    assert deleted.status_code == 404
    assert deleted.json()["detail"] == "模板不存在"


def test_pdf_extract_api_loads_selected_template(monkeypatch):
    seen = {}

    def fake_extract(data, backend, filename, template=None):
        seen.update(backend=backend, filename=filename, template=template)
        return {"kind": "table", "rows": [["ok"]], "backend": backend, "template": template}

    monkeypatch.setattr(pdf_extract, "extract_pdf", fake_extract)
    monkeypatch.setattr(server, "load_doc_recipe", lambda name: {"name": name, "fields": []})
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("invoice.pdf", b"%PDF-", "application/pdf")},
        data={"ocr_backend": "local", "template": "增值税发票"},
    )
    assert response.status_code == 200
    assert response.json()["template"] == {"name": "增值税发票", "fields": []}
    assert seen["backend"] == "local"


def test_pdf_extract_api_rejects_missing_template(monkeypatch):
    def fail_extract(*_args, **_kwargs):
        raise AssertionError("missing template must not run extraction")

    monkeypatch.setattr(pdf_extract, "extract_pdf", fail_extract)

    def missing(_name):
        raise FileNotFoundError("模板不存在")

    monkeypatch.setattr(server, "load_doc_recipe", missing)
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("invoice.pdf", b"%PDF-", "application/pdf")},
        data={"ocr_backend": "local", "template": "missing"},
    )
    assert response.status_code == 400
    assert "模板不存在" in response.json()["detail"]


def test_pdf_extract_api_rejects_corrupted_template(monkeypatch):
    def fail_extract(*_args, **_kwargs):
        raise AssertionError("corrupted template must not run extraction")

    monkeypatch.setattr(pdf_extract, "extract_pdf", fail_extract)

    def corrupted(_name):
        raise ValueError("模板文件损坏")

    monkeypatch.setattr(server, "load_doc_recipe", corrupted)
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("invoice.pdf", b"%PDF-", "application/pdf")},
        data={"ocr_backend": "local", "template": "broken"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "模板文件损坏"

from io import BytesIO

from PIL import Image

from layout_doc import KVItem, LayoutDocument, TableBlock  # noqa: E402


def _png_bytes() -> bytes:
    buf = BytesIO()
    Image.new("L", (4, 4), 255).save(buf, "PNG")
    return buf.getvalue()


def _fake_layout() -> LayoutDocument:
    return LayoutDocument(
        kvs=[KVItem("发票号码", "12345678")],
        tables=[
            TableBlock(
                name="表",
                headers=["品名", "金额"],
                rows=[["A", "1,234.56"]],
            )
        ],
    )


def _patch_local_image_pipeline(monkeypatch, layout):
    monkeypatch.setattr(pdf_extract, "preprocess_image", lambda data: object())
    monkeypatch.setattr(pdf_extract, "extract_layout_from_image", lambda image: layout)
    monkeypatch.setattr(
        pdf_extract,
        "extract_image_ocr_local",
        lambda data, image=None: "发票号码: 12345678\nA\t1,234.56\nB\t56.00",
    )


def test_extract_pdf_returns_sheets_for_group_template(monkeypatch):
    _patch_local_image_pipeline(monkeypatch, _fake_layout())
    template = {
        "name": "发票",
        "fields": [
            {"name": "品名", "type": "text", "source": "品名", "group": "detail"},
            {
                "name": "金额",
                "type": "number",
                "source": "金额",
                "group": "detail",
                "format": {"numberStyle": "us"},
            },
            {"name": "发票号码", "type": "text", "source": "发票号码", "group": "header"},
        ],
    }
    result = pdf_extract.extract_pdf(_png_bytes(), "local", "invoice.png", template)
    assert result["kind"] == "table"
    assert len(result["sheets"]) == 2
    assert result["sheets"][0]["name"] == "发票-明细"
    assert result["sheets"][0]["rows"][1] == ["A", 1234.56]
    assert result["sheets"][1]["name"] == "发票-抬头"
    assert ["发票号码", "12345678"] in result["sheets"][1]["rows"]


def test_extract_pdf_returns_proposed_recipe_without_template(monkeypatch):
    _patch_local_image_pipeline(monkeypatch, _fake_layout())
    result = pdf_extract.extract_pdf(_png_bytes(), "local", "invoice.png")
    assert "sheets" not in result
    proposed = result["proposedRecipe"]
    assert proposed["name"] == "invoice"
    detail = [f for f in proposed["fields"] if f["group"] == "detail"]
    header = [f for f in proposed["fields"] if f["group"] == "header"]
    assert [f["source"] for f in detail] == ["品名", "金额"]
    assert header[0]["source"] == "发票号码"


def test_extract_pdf_old_template_keeps_rows_single_table(monkeypatch):
    _patch_local_image_pipeline(monkeypatch, _fake_layout())
    template = {
        "name": "发票",
        "fields": [
            {"name": "品名", "type": "text"},
            {"name": "金额", "type": "number", "format": {"numberStyle": "us"}},
        ],
    }
    result = pdf_extract.extract_pdf(_png_bytes(), "local", "invoice.png", template)
    assert "sheets" not in result
    assert result["rows"] == [
        ["品名", "金额"],
        ["A", 1234.56],
        ["B", 56.0],
    ]


def test_pdf_extract_api_serializes_sheets(monkeypatch):
    monkeypatch.setattr(
        pdf_extract,
        "extract_pdf",
        lambda data, backend, filename, template=None: {
            "kind": "table",
            "rows": [["品名", "金额"], ["A", 1234.56]],
            "sheets": [
                {"name": "发票-明细", "rows": [["品名", "金额"], ["A", 1234.56]]},
                {"name": "发票-抬头", "rows": [["字段", "值"], ["发票号码", "12345678"]]},
            ],
        },
    )
    monkeypatch.setattr(
        server,
        "load_doc_recipe",
        lambda name: {"name": name, "fields": [{"name": "品名", "type": "text", "group": "detail"}]},
    )
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("invoice.pdf", b"%PDF-", "application/pdf")},
        data={"ocr_backend": "local", "template": "发票"},
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["sheets"]) == 2
    assert data["sheets"][0]["rows"][1] == ["A", 1234.56]


def test_pdf_extract_api_serializes_proposed_recipe(monkeypatch):
    monkeypatch.setattr(
        pdf_extract,
        "extract_pdf",
        lambda data, backend, filename, template=None: {
            "kind": "text",
            "text": "发票号码: 12345678",
            "proposedRecipe": {
                "name": "invoice",
                "description": "自动生成，请确认字段名与类型",
                "fields": [
                    {"name": "发票号码", "type": "number", "source": "发票号码", "group": "header"}
                ],
            },
        },
    )
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("invoice.pdf", b"%PDF-", "application/pdf")},
        data={"ocr_backend": "local"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["proposedRecipe"]["name"] == "invoice"
    assert data["proposedRecipe"]["fields"][0]["source"] == "发票号码"
