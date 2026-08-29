"""HTTP behavior for PDF extraction, especially the cloud authorization gate."""

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


def test_pdf_rejects_empty_upload(monkeypatch):
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("empty.pdf", b"", "application/pdf")},
        data={"ocr_backend": "local"},
    )
    assert response.status_code == 400
    assert "PDF 文件为空" in response.json()["detail"]


def test_invalid_pdf_returns_readable_error(monkeypatch):
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("bad.pdf", b"not-pdf", "application/pdf")},
        data={"ocr_backend": "local"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["kind"] == "scanned"
    assert "PDF 或图片" in data["error"]


def test_cloud_requires_explicit_confirmation(monkeypatch):
    called = False

    def fail_extract(*_args, **_kwargs):
        nonlocal called
        called = True
        raise AssertionError("cloud extraction must not run without consent")

    monkeypatch.setattr(pdf_extract, "extract_pdf", fail_extract)
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("scan.pdf", b"%PDF-", "application/pdf")},
        data={"ocr_backend": "cloud"},
    )
    assert response.status_code == 200
    assert response.json() == {"error": "云 OCR 需前端确认授权"}
    assert called is False


def test_confirmed_cloud_passes_backend(monkeypatch):
    seen = {}

    def fake_extract(data, backend, filename):
        nonlocal seen
        seen = {"backend": backend, "filename": filename, "size": len(data)}
        return {"kind": "text", "text": "ok", "filename": filename, **seen}

    monkeypatch.setattr(pdf_extract, "extract_pdf", fake_extract)
    client = _client(monkeypatch)
    response = client.post(
        "/api/pdf/extract",
        files={"file": ("scan.pdf", b"%PDF-", "application/pdf")},
        data={"ocr_backend": "cloud", "cloudConfirmed": "true"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["backend"] == "cloud"
    assert data["filename"] == "scan.pdf"
    assert data["size"] == 5
