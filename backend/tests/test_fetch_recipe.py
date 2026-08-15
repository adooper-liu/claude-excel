"""Follow-the-user fetch recipe."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import fetch_recipe as fr  # noqa: E402
from fetch_recipe import (  # noqa: E402
    archive_ingest_rows,
    data_sheet_template_key,
    default_recipe,
    drop_repeated_header,
    export_recipe,
    fetch_repeat_warning,
    host_from_sheet_name,
    import_recipe,
    list_recipes,
    project_targets_for_sheet,
    resolve_project_for_sheet,
    resolve_project_for_url,
    save_recipe,
    touch_recipe_fetch,
    update_recipe_from_picker,
    validate_recipe,
)


def test_default_recipe_is_manual():
    r = default_recipe("https://shop.example.com/list")
    assert r["iterate"]["type"] == "manual"
    assert r["extract"]["mode"] == "table"
    assert r["extract"]["fields"] == []
    assert "password" not in r


def test_validate_recipe_clamps_and_drops_unknown_iterate():
    r = validate_recipe(
        {
            "url": "https://a.example",
            "iterate": {"type": "botnet", "maxPages": 9999, "maxRows": -1},
            "extract": {"mode": "box", "gridIndex": 2},
        }
    )
    assert r["iterate"]["type"] == "manual"
    assert r["iterate"]["maxPages"] == 200
    assert r["iterate"]["maxRows"] == 1
    assert r["extract"]["mode"] == "box"
    assert r["extract"]["gridIndex"] == 2


def test_drop_repeated_header():
    header = ["店铺", "金额"]
    rows = [["店铺", "金额"], ["A", "1"]]
    assert drop_repeated_header(header, rows) == [["A", "1"]]
    assert drop_repeated_header(header, [["A", "1"]]) == [["A", "1"]]
    assert drop_repeated_header([], rows) == rows


def test_save_recipe_writes_host_file(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(fr, "RECIPES_DIR", tmp_path / "fetch-recipes")
    monkeypatch.setattr(fr, "RECIPE_FILE", tmp_path / "fetch-recipe-last.json")
    saved = save_recipe(default_recipe("https://www.amazon.com/s?k=bed"))
    host_file = tmp_path / "fetch-recipes" / "amazon.com.json"
    assert host_file.is_file()
    assert saved["host"] == "amazon.com"
    assert json.loads(host_file.read_text(encoding="utf-8"))["url"].startswith("https://")


def test_update_recipe_from_picker_stores_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(fr, "RECIPES_DIR", tmp_path / "fetch-recipes")
    monkeypatch.setattr(fr, "RECIPE_FILE", tmp_path / "fetch-recipe-last.json")
    saved = update_recipe_from_picker(
        "https://www.amazon.com/s",
        fields=[{"name": "排名", "col": 0}, {"name": "售价", "col": 10, "mergeCols": [11, 12, 13]}],
        has_head=True,
        mode="picker",
        column_labels=["排名", "标题", "售价"],
    )
    assert saved["extract"]["mode"] == "picker"
    assert len(saved["extract"]["fields"]) == 2
    assert saved["extract"]["columnLabels"][0] == "排名"
    exported = export_recipe("https://www.amazon.com/s")
    assert exported["recipe"]["host"] == "amazon.com"
    assert "amazon.com.json" in exported["path"]
    assert len(list_recipes()) == 1
    imported = import_recipe(saved)
    assert imported["ok"] is True


def test_amazon_template_has_project_columns(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(fr, "RECIPES_DIR", tmp_path / "fetch-recipes")
    monkeypatch.setattr(fr, "RECIPE_FILE", tmp_path / "fetch-recipe-last.json")
    saved = save_recipe(default_recipe("https://www.amazon.com/s?k=bed"))
    assert len(saved["project"]["columns"]) == 9
    proj = resolve_project_for_url("https://www.amazon.com/s?k=bed")
    assert proj["columns"][0]["as"] == "排名"
    assert proj["columns"][6]["merge"] == [11, 12, 13]


def test_host_from_sheet_name():
    assert host_from_sheet_name("取数_amazon.com") == "amazon.com"
    assert host_from_sheet_name("订单表") == ""


def test_fetch_repeat_warning_within_cooldown(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(fr, "RECIPES_DIR", tmp_path / "fetch-recipes")
    monkeypatch.setattr(fr, "RECIPE_FILE", tmp_path / "fetch-recipe-last.json")
    url = "https://www.amazon.com/s"
    touch_recipe_fetch(url, 42)
    msg = fetch_repeat_warning(url)
    assert "刚取过" in msg
    assert "42" in msg


def test_touch_recipe_keeps_picker_fields(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(fr, "RECIPES_DIR", tmp_path / "fetch-recipes")
    monkeypatch.setattr(fr, "RECIPE_FILE", tmp_path / "fetch-recipe-last.json")
    url = "https://www.amazon.com/s"
    update_recipe_from_picker(url, fields=[{"name": "排名", "col": 0}], has_head=True)
    touch_recipe_fetch(url, 10)
    exported = export_recipe(url)
    assert len(exported["recipe"]["extract"]["fields"]) == 1
    assert exported["recipe"]["lastFetchRows"] == 10


def test_archive_ingest_rows(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "DATA_DIR", tmp_path / "fetch-data")
    path = archive_ingest_rows("https://www.amazon.com/s", [["1", "x"]], "jobid123")
    assert Path(path).is_file()
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    assert payload["rowCount"] == 1


def test_host_alias_1688():
    assert fr.recipe_host_key("https://s.1688.com/selloffer/offer_search.htm") == "1688.com"
    assert fr.recipe_host_key("https://detail.1688.com/offer/123.html") == "1688.com"


def test_ebay_walmart_templates_have_targets():
    ebay = fr.default_recipe("https://www.ebay.com/sch/i.html?_nkw=x")
    assert ebay["host"] == "ebay.com"
    assert "标题" in ebay["project"]["targets"]
    walmart = fr.default_recipe("https://www.walmart.com/search?q=x")
    assert "ItemId" in walmart["project"]["targets"]


def test_data_sheet_1688_project_by_header():
    proj = resolve_project_for_sheet("导入_1688选品", "", None)
    assert proj is not None
    assert proj["headerless"] is False
    assert proj["columns"][0]["as"] == "标题"
    assert proj["columns"][0]["from"] == "title"


def test_data_sheet_sif_keyword():
    assert data_sheet_template_key("导入_SIF关键词") == "sif.keyword"
    proj = resolve_project_for_sheet("导入_SIF关键词", "", None)
    assert proj and any(c.get("as") == "供需比" for c in proj["columns"])


def test_project_targets_for_ebay_sheet():
    t = project_targets_for_sheet("取数_ebay.com", "https://www.ebay.com/sch/i.html")
    assert "成色" in t
