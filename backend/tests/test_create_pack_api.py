"""POST /api/user-skills/create-pack — L3 S1 HTTP 门禁."""

import base64
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

from test_user_packs_store import _S1_SKILL_MD, _make_zip, _patch_create_pack_dirs  # noqa: E402


def test_create_pack_api_json_zipbase64(tmp_path, monkeypatch):
    import server

    _patch_create_pack_dirs(tmp_path, monkeypatch)
    monkeypatch.setattr(server, "require_loopback", lambda _request: None)

    z = _make_zip(
        {
            "pack.json": json.dumps(
                {
                    "id": "vendor-s1-api",
                    "category": "自定义",
                    "title": "API",
                    "skills": ["s1-demo-skill"],
                }
            ),
            "skills/s1-demo-skill/SKILL.md": _S1_SKILL_MD,
        }
    )
    client = TestClient(server.app)
    r = client.post(
        "/api/user-skills/create-pack",
        json={"zipBase64": base64.b64encode(z).decode("ascii")},
    )
    assert r.status_code == 200, r.text
    pack = r.json()["pack"]
    assert pack["packId"] == "vendor-s1-api"
    assert pack["imported"] is True
    assert (tmp_path / "skills" / "s1-demo-skill" / "SKILL.md").is_file()


def test_create_pack_api_files_json(tmp_path, monkeypatch):
    import server

    _patch_create_pack_dirs(tmp_path, monkeypatch)
    monkeypatch.setattr(server, "require_loopback", lambda _request: None)

    client = TestClient(server.app)
    r = client.post(
        "/api/user-skills/create-pack",
        json={
            "files": {
                "pack.json": json.dumps(
                    {
                        "id": "vendor-s1-files",
                        "category": "自定义",
                        "title": "Files",
                        "skills": ["s1-demo-skill"],
                    }
                ),
                "skills/s1-demo-skill/SKILL.md": _S1_SKILL_MD,
            }
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["pack"]["packId"] == "vendor-s1-files"
    assert (tmp_path / "skills" / "s1-demo-skill" / "SKILL.md").is_file()


def test_create_pack_api_bad_zip_400(tmp_path, monkeypatch):
    import server

    _patch_create_pack_dirs(tmp_path, monkeypatch)
    monkeypatch.setattr(server, "require_loopback", lambda _request: None)

    client = TestClient(server.app)
    r = client.post(
        "/api/user-skills/create-pack",
        json={"zipBase64": base64.b64encode(_make_zip({"readme.txt": "x"})).decode("ascii")},
    )
    assert r.status_code == 400
    assert "pack.json" in str(r.json().get("detail") or "")
