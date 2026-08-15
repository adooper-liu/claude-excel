"""Follow-the-user fetch recipe."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from fetch_recipe import default_recipe, drop_repeated_header, validate_recipe  # noqa: E402


def test_default_recipe_is_manual():
    r = default_recipe("https://shop.example.com/list")
    assert r["iterate"]["type"] == "manual"
    assert r["extract"]["mode"] == "table"
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
