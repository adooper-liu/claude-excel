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

    def fake_save(raw, *, sample_data=None, sample_filename=""):
        saved.update(
            raw=raw,
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
