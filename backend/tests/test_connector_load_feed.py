"""Gate 1b: user.connector_load_feed + pack connector install."""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from user_fn_runner import run_user_fn  # noqa: E402
from user_packs_store import install_pack  # noqa: E402


@pytest.fixture
def isolated_pack_env(tmp_path, monkeypatch):
    import user_extension_registry
    import user_packs_store
    import user_skills_store

    runtime = tmp_path / "packs"
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", runtime)
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", runtime)
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")

    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("USERPROFILE", str(home))
    monkeypatch.setenv("HOME", str(home))
    # handler resolves ~/.claude-excel-web — mirror runtime packs there
    web = home / ".claude-excel-web" / "packs"
    web.mkdir(parents=True)

    def sync_runtime(pack_id: str):
        src = runtime / pack_id
        dst = web / pack_id
        if dst.exists():
            import shutil

            shutil.rmtree(dst)
        if src.exists():
            import shutil

            shutil.copytree(src, dst)

    return tmp_path, sync_runtime


@pytest.mark.asyncio
async def test_install_pack_copies_connector(isolated_pack_env):
    tmp_path, sync = isolated_pack_env
    result = install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    assert result["packId"] == "cross-border-ecommerce-finance"
    sync("cross-border-ecommerce-finance")

    connector = tmp_path / "packs" / "cross-border-ecommerce-finance" / "connector"
    assert (connector / "fixtures" / "orders.csv").is_file()
    assert (connector / "feeds" / "orders.schema.json").is_file()
    assert any(e["name"] == "user.connector_load_feed" for e in result.get("extensions") or [])


@pytest.mark.asyncio
async def test_connector_load_feed_orders(isolated_pack_env):
    _tmp_path, sync = isolated_pack_env
    install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    sync("cross-border-ecommerce-finance")

    out = await run_user_fn("user.connector_load_feed", {"feed": "orders"})
    assert out["ok"] is True
    data = out["data"]
    assert data["sheetName"] == "Pack_订单"
    assert "platform_sku" in data["headers"]
    assert "biz_date" in data["headers"]
    assert data["rows"]
    skus = [r[data["headers"].index("platform_sku")] for r in data["rows"]]
    assert "widget-a" in skus
    assert data["meta"]["sourceHash"]


@pytest.mark.asyncio
async def test_connector_load_feed_normalizes_sku_and_dates(isolated_pack_env):
    _tmp_path, sync = isolated_pack_env
    install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    sync("cross-border-ecommerce-finance")

    ads = await run_user_fn("user.connector_load_feed", {"feed": "ads"})
    assert ads["ok"] is True
    headers = ads["data"]["headers"]
    sku_i = headers.index("platform_sku")
    date_i = headers.index("biz_date")
    first = ads["data"]["rows"][0]
    assert first[sku_i] == "abc-01"
    assert first[date_i] == "2026-01-15"
