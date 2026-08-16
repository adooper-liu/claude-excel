"""P1 user.* runner: subprocess isolation, registry, authorization."""

import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from skill_registry import ADDIN_HANDLERS  # noqa: E402
from user_extension_registry import (  # noqa: E402
    INSTALLED_PACKS_FILE,
    RUNTIME_PACKS_DIR,
    extension_capability_hash,
    get_extension,
    list_extensions,
    pack_capability_hash,
)
from user_fn_runner import clean_env, run_user_fn, verify_clean_env_no_llm_keys  # noqa: E402


@pytest.fixture
def isolated_user_fn_env(tmp_path, monkeypatch):
    import user_extension_registry
    import user_packs_store
    import user_skills_store

    runtime = tmp_path / "packs"
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", runtime)
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", runtime)
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    return tmp_path


def _write_extension(tmp_path: Path, pack_id: str, ext_id: str, manifest: dict, handler_src: str):
    ext_dir = tmp_path / "packs" / pack_id / "extensions" / ext_id
    ext_dir.mkdir(parents=True, exist_ok=True)
    (ext_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (ext_dir / "handler.py").write_text(handler_src, encoding="utf-8")


def _authorize_pack(tmp_path: Path, pack_id: str, cap_hash: str):
    rec = [
        {
            "id": pack_id,
            "installedAt": "2026-01-01T00:00:00+00:00",
            "version": "0.1.0",
            "capabilityHash": cap_hash,
            "consentedAt": "2026-01-01T00:00:00+00:00",
        }
    ]
    (tmp_path / "installed_packs.json").write_text(json.dumps(rec), encoding="utf-8")


def test_user_tools_not_in_addin_handlers():
    for name in ADDIN_HANDLERS:
        assert not name.startswith("user."), "user.* must not be in ADDIN_HANDLERS"


def test_clean_env_strips_llm_keys():
    assert verify_clean_env_no_llm_keys()


@pytest.mark.asyncio
async def test_profit_assumptions_runs(isolated_user_fn_env):
    manifest = {
        "name": "user.profit_assumptions",
        "description": "profit",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = '''
import json, sys
params = json.loads(sys.stdin.read() or "{}")
asins = params.get("asins") or ["B001"]
sys.stdout.write(json.dumps({"assumptions": asins, "count": len(asins)}))
'''
    _write_extension(isolated_user_fn_env, "demo", "profit-assumptions", manifest, handler)
    cap = pack_capability_hash([manifest])
    _authorize_pack(isolated_user_fn_env, "demo", cap)

    result = await run_user_fn("user.profit_assumptions", {"asins": ["A1", "A2"]})
    assert result["ok"] is True
    assert result["data"]["count"] == 2


@pytest.mark.asyncio
async def test_not_authorized_without_consent(isolated_user_fn_env):
    manifest = {
        "name": "user.demo_fn",
        "description": "demo",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = 'import json, sys\nsys.stdout.write("{}")\n'
    _write_extension(isolated_user_fn_env, "demo", "demo-ext", manifest, handler)

    result = await run_user_fn("user.demo_fn", {})
    assert result["ok"] is False
    assert result["error"]["code"] == "NOT_AUTHORIZED"


@pytest.mark.asyncio
async def test_capability_hash_change_rejects(isolated_user_fn_env):
    manifest = {
        "name": "user.demo_fn",
        "description": "demo",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = 'import json, sys\nsys.stdout.write(json.dumps({"ok": True}))\n'
    _write_extension(isolated_user_fn_env, "demo", "demo-ext", manifest, handler)
    _authorize_pack(isolated_user_fn_env, "demo", "wrong-hash")

    result = await run_user_fn("user.demo_fn", {})
    assert result["ok"] is False
    assert result["error"]["code"] == "NOT_AUTHORIZED"


@pytest.mark.asyncio
async def test_invalid_name_rejected(isolated_user_fn_env):
    result = await run_user_fn("not_user_fn", {})
    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_NAME"


@pytest.mark.asyncio
async def test_invalid_stdout_json(isolated_user_fn_env):
    manifest = {
        "name": "user.bad_json",
        "description": "bad",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = 'print("not json")\n'
    _write_extension(isolated_user_fn_env, "demo", "bad", manifest, handler)
    cap = pack_capability_hash([manifest])
    _authorize_pack(isolated_user_fn_env, "demo", cap)

    result = await run_user_fn("user.bad_json", {})
    assert result["ok"] is False
    assert result["error"]["code"] == "INVALID_JSON"


@pytest.mark.asyncio
async def test_timeout(isolated_user_fn_env):
    manifest = {
        "name": "user.slow_fn",
        "description": "slow",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 500,
    }
    handler = "import time\ntime.sleep(5)\n"
    _write_extension(isolated_user_fn_env, "demo", "slow", manifest, handler)
    cap = pack_capability_hash([manifest])
    _authorize_pack(isolated_user_fn_env, "demo", cap)

    result = await run_user_fn("user.slow_fn", {})
    assert result["ok"] is False
    assert result["error"]["code"] == "TIMEOUT"


@pytest.mark.asyncio
async def test_nonzero_exit(isolated_user_fn_env):
    manifest = {
        "name": "user.fail_fn",
        "description": "fail",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = "import sys\nsys.exit(2)\n"
    _write_extension(isolated_user_fn_env, "demo", "fail", manifest, handler)
    cap = pack_capability_hash([manifest])
    _authorize_pack(isolated_user_fn_env, "demo", cap)

    result = await run_user_fn("user.fail_fn", {})
    assert result["ok"] is False
    assert result["error"]["code"] == "NONZERO_EXIT"


def test_list_extensions_unauthorized_still_listed(isolated_user_fn_env):
    manifest = {
        "name": "user.listed_fn",
        "description": "listed",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = 'import json, sys\nsys.stdout.write("{}")\n'
    _write_extension(isolated_user_fn_env, "demo", "listed", manifest, handler)

    exts = list_extensions()
    assert any(e.name == "user.listed_fn" for e in exts)
    ext = get_extension("user.listed_fn")
    assert ext is not None
    assert ext.authorized is False


def test_extension_capability_hash_stable():
    m = {"network": False, "secrets": ["hs_key", "other"]}
    h1 = extension_capability_hash(m)
    h2 = extension_capability_hash({"network": False, "secrets": ["other", "hs_key"]})
    assert h1 == h2


@pytest.mark.asyncio
async def test_network_handler_can_import_ce_http(isolated_user_fn_env):
    manifest = {
        "name": "user.net_fn",
        "description": "net import probe",
        "entry": "handler.py",
        "returns": "json",
        "network": True,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = '''
import json, sys, ce_http
ok = hasattr(ce_http, "get") and hasattr(ce_http, "post")
sys.stdout.write(json.dumps({"imported": ok}))
'''
    _write_extension(isolated_user_fn_env, "demo", "net-ext", manifest, handler)
    cap = pack_capability_hash([manifest])
    _authorize_pack(isolated_user_fn_env, "demo", cap)

    result = await run_user_fn("user.net_fn", {})
    assert result["ok"] is True
    assert result["data"]["imported"] is True


@pytest.mark.asyncio
async def test_invalid_manifest_name_not_registered(isolated_user_fn_env):
    manifest = {
        "name": "user.Invalid-Name",
        "description": "bad name",
        "entry": "handler.py",
        "returns": "json",
        "network": False,
        "secrets": [],
        "timeoutMs": 5000,
    }
    handler = 'import json, sys\nsys.stdout.write("{}")\n'
    _write_extension(isolated_user_fn_env, "demo", "bad-name", manifest, handler)
    assert get_extension("user.Invalid-Name") is None
