"""In-page picker script is present and teaches click-similar."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PICKER = ROOT / "extension" / "picker.js"


def test_picker_js_has_click_similar_and_multi_box():
    text = PICKER.read_text(encoding="utf-8")
    assert "ceInstallPagePicker" in text
    assert "similarItems" in text
    assert "点选" in text
    assert "框选" in text
    assert "sendGrid" in text
    assert "ce-ingest" in text
    assert "__cePicker" in text
    assert "ce-excel-preview" in text
    assert "写入这" in text
    assert "ce-stat" in text
    assert "还没选中内容" in text
    assert "0.4.4" in text
    assert "PICKER_VER" in text
    assert "data-ce-ver" in text
    assert "looksLikeHeaderRow" in text
    assert "撤销" in text
    assert "undoLast" in text
    assert "浏览/翻页" in text
    assert 'getAttribute("data-ce-ver") === PICKER_VER' in text
    assert "点选同类" not in text
    assert "再选一块" not in text
    assert "还没有接口表" not in text


def test_ver_tuple_orders_versions():
    import sys

    sys.path.insert(0, str(ROOT / "backend"))
    from web_browser import _ver_tuple

    assert _ver_tuple("0.4.3") < _ver_tuple("0.4.4")
    assert _ver_tuple("0.4.4") >= _ver_tuple("0.4.4")
    assert not (_ver_tuple("0.4.4") < _ver_tuple("0.4.3"))


def test_product_cards_are_not_headers():
    import subprocess

    script = r"""
const { runInNewContext } = require("vm");
const fs = require("fs");
const code = fs.readFileSync(process.env.PICKER, "utf8");
const ctx = {
  window: {},
  globalThis: {},
  document: { getElementById() { return null; }, querySelectorAll() { return []; } },
};
ctx.window = ctx;
ctx.globalThis = ctx;
runInNewContext(code, ctx);
const fn = ctx.ceLooksLikeHeaderRow;
const cards = ["+14", "Bedsure PureWove", "选项:", "CNY 67.29", "4.4 颗星"];
const cards2 = ["+8", "BEDELITE", "选项:", "CNY 50.00", "4.3 颗星"];
if (fn(cards, cards2)) { console.error("cards"); process.exit(1); }
const head = ["店铺", "订单号", "金额", "日期"];
const body = ["A店", "123", "12.5", "2024-01-01"];
if (!fn(head, body)) { console.error("table"); process.exit(1); }
console.log("ok");
"""
    env = dict(**__import__("os").environ, PICKER=str(PICKER))
    r = subprocess.run(
        ["node", "-e", script],
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    assert r.returncode == 0, r.stderr or r.stdout


def test_picker_bundle_is_new_ui():
    import sys

    sys.path.insert(0, str(ROOT / "backend"))
    from web_browser import PICKER_UI_VER, _picker_bundle

    bundle = _picker_bundle()
    assert PICKER_UI_VER in bundle
    assert "ce-stat" in bundle
    assert "还没选中内容" in bundle
    assert "写入新表" not in bundle


def test_net_hook_and_json_table_exist():
    root = ROOT / "extension"
    hook = (root / "net-hook.js").read_text(encoding="utf-8")
    table = (root / "json-table.js").read_text(encoding="utf-8")
    assert "XMLHttpRequest" in hook
    assert "window.fetch" in hook
    assert "ceJsonToGrid" in hook
    assert "function jsonToGrid" in table or "jsonToGrid" in table
    assert "sorftime" not in hook.lower()
    assert "shopee" not in hook.lower()
    assert "flyout" in hook
    assert "ceIsCaptureGrid" in hook
