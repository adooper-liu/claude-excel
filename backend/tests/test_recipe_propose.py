"""Behavioral contract for type inference and template proposal."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from layout_doc import KVItem, LayoutDocument, TableBlock  # noqa: E402
from recipe_propose import infer_type, propose_recipe  # noqa: E402


def test_infer_type_rules():
    assert infer_type(["13%", "15%"]) == "percent"
    assert infer_type(["$1,234.56", "￥56.00"]) == "amount"
    assert infer_type(["1,234.56", "56.00"]) == "number"
    assert infer_type(["2026-08-30", "2026/08/30"]) == "date"
    assert infer_type(["苹果", "香蕉"]) == "text"
    assert infer_type([]) == "text"


def test_propose_recipe_uses_table_headers():
    layout = LayoutDocument(
        tables=[
            TableBlock(
                name="表",
                headers=["品名", "金额", "税率"],
                rows=[["A", "1,234.56", "13%"]],
            )
        ]
    )
    recipe = propose_recipe(layout)
    assert recipe["description"] == "自动生成，请确认字段名与类型"
    detail = [f for f in recipe["fields"] if f["group"] == "detail"]
    assert [(f["name"], f["type"], f["source"]) for f in detail] == [
        ("品名", "text", "品名"),
        ("金额", "number", "金额"),
        ("税率", "percent", "税率"),
    ]


def test_propose_recipe_adds_header_fields_from_kvs():
    layout = LayoutDocument(kvs=[KVItem("发票号码", "12345678")])
    recipe = propose_recipe(layout, base_name="发票")
    assert recipe["name"] == "发票"
    assert recipe["fields"] == [
        {"name": "发票号码", "type": "number", "source": "发票号码", "group": "header"}
    ]


def test_propose_recipe_empty_layout_does_not_crash():
    recipe = propose_recipe(LayoutDocument(), base_name="空文档")
    assert recipe["name"] == "空文档"
    assert recipe["fields"] == []
