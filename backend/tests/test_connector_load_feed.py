"""Gate 1b: user.connector_load_feed + pack connector install."""

import base64
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


@pytest.mark.asyncio
async def test_connector_load_feed_content_base64_gbk(isolated_pack_env):
    _tmp_path, sync = isolated_pack_env
    install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    sync("cross-border-ecommerce-finance")

    csv_gbk = (
        "订单号,成交日,sku,数量,单价,币种\n"
        "O-gbk,2026-01-15,Widget-Gbk,2,19.99,USD\n"
    ).encode("gbk")
    b64 = base64.b64encode(csv_gbk).decode("ascii")

    out = await run_user_fn(
        "user.connector_load_feed",
        {"feed": "orders", "contentBase64": b64},
    )
    assert out["ok"] is True
    data = out["data"]
    assert data["meta"]["source"] == "csv_upload"
    headers = data["headers"]
    sku_i = headers.index("platform_sku")
    assert data["rows"][0][sku_i] == "widget-gbk"


@pytest.mark.asyncio
async def test_connector_load_feed_settlement_and_bank(isolated_pack_env):
    _tmp_path, sync = isolated_pack_env
    install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    sync("cross-border-ecommerce-finance")

    settlement = await run_user_fn("user.connector_load_feed", {"feed": "settlement"})
    assert settlement["ok"] is True
    assert settlement["data"]["sheetName"] == "Pack_结算"
    assert "amount" in settlement["data"]["headers"]
    assert "biz_date" in settlement["data"]["headers"]
    assert settlement["data"]["rows"]

    bank = await run_user_fn("user.connector_load_feed", {"feed": "bank"})
    assert bank["ok"] is True
    assert bank["data"]["sheetName"] == "Pack_银行"
    assert "settlement_id" in bank["data"]["headers"]
    assert bank["data"]["rows"]


@pytest.mark.asyncio
async def test_connector_load_feed_content_skips_fixture(isolated_pack_env):
    _tmp_path, sync = isolated_pack_env
    install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    sync("cross-border-ecommerce-finance")

    csv_text = (
        "order_id,order_date,platform_sku,quantity,item_price,currency\n"
        "O-upload,2026-02-01,upload-sku,1,9.5,USD\n"
    )
    out = await run_user_fn(
        "user.connector_load_feed",
        {"feed": "orders", "content": csv_text},
    )
    assert out["ok"] is True
    assert out["data"]["meta"]["sourceFile"] == "upload"
    headers = out["data"]["headers"]
    sku_i = headers.index("platform_sku")
    assert out["data"]["rows"][0][sku_i] == "upload-sku"
