"""Behavioral contract for template position anchors (roadmap \u2467).

Semantic ``source`` stays the primary matcher; the normalized ``position`` is a
spatial fallback/disambiguator resolved against the OCR-derived positions, and
it never becomes a hard gate (drift silently falls back to empty, not failure).
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from doc_recipe import _normalize_fields  # noqa: E402
from format_clean import (  # noqa: E402
    _column_by_position,
    _kv_by_position,
    apply_recipe,
)
from layout_doc import KVItem, LayoutDocument, TableBlock  # noqa: E402


def _sheet(sheets, name):
    return next(s for s in sheets if s["name"] == name)


def test_template_roundtrip_preserves_position():
    fields = _normalize_fields(
        [
            {
                "name": "发票号码",
                "type": "text",
                "source": "发票号码",
                "group": "header",
                "position": [0.6, 0.02, 0.9, 0.05],
            },
            {
                "name": "金额",
                "type": "number",
                "source": "金额",
                "group": "detail",
                "position": [0.6, 0.0, 0.6, 1.0],
            },
        ]
    )
    assert fields[0]["position"] == [0.6, 0.02, 0.9, 0.05]
    assert fields[1]["position"] == [0.6, 0.0, 0.6, 1.0]
    # invalid positions are dropped, never fail the recipe
    bad = _normalize_fields(
        [{"name": "x", "type": "text", "position": [2.0, 0.0, 0.0, 0.0]}]
    )
    assert "position" not in bad[0]
    bad2 = _normalize_fields([{"name": "x", "type": "text", "position": [0, 0]}])
    assert "position" not in bad2[0]


def test_layout_roundtrip_preserves_positions():
    doc = LayoutDocument(
        kvs=[KVItem("发票号码", "12345678", (0.6, 0.02, 0.9, 0.05))],
        tables=[
            TableBlock(
                name="表",
                headers=["金额"],
                rows=[["1.5"]],
                column_positions=[0.6],
            )
        ],
    )
    back = LayoutDocument.from_dict(doc.to_dict())
    assert back.kvs[0].position == (0.6, 0.02, 0.9, 0.05)
    assert back.tables[0].column_positions == [0.6]


def test_header_position_fallback_when_source_missing():
    layout = LayoutDocument(
        kvs=[KVItem("发票号码", "12345678", (0.6, 0.02, 0.9, 0.05))]
    )
    template = {
        "name": "t",
        "fields": [
            {
                "name": "发票号",
                "type": "text",
                "source": "发票号",  # semantic miss
                "group": "header",
                "position": [0.6, 0.02, 0.9, 0.05],
            }
        ],
    }
    sheets = apply_recipe(layout, template)
    header = _sheet(sheets, "t-抬头")
    assert header["rows"][1] == ["发票号", "12345678"]


def test_detail_position_fallback_when_column_missing():
    layout = LayoutDocument(
        tables=[
            TableBlock(
                name="表",
                headers=["品名", "金额"],
                rows=[["A", "1.5"]],
                column_positions=[0.0, 1.0],
            )
        ]
    )
    template = {
        "name": "t",
        "fields": [
            {
                "name": "金额",
                "type": "number",
                "source": "金额金额",  # semantic miss
                "group": "detail",
                "position": [1.0, 0.0, 1.0, 1.0],
            }
        ],
    }
    sheets = apply_recipe(layout, template)
    detail = _sheet(sheets, "t-明细")
    # number-type cleaning turns "1.5" into the float 1.5 (correct behavior)
    assert detail["rows"][1] == [1.5]


def test_position_drift_falls_back_without_failing():
    # semantic source matches -> position (even far away) is ignored
    layout = LayoutDocument(
        kvs=[KVItem("发票号码", "12345678", (0.1, 0.1, 0.2, 0.12))]
    )
    template = {
        "name": "t",
        "fields": [
            {
                "name": "发票号",
                "type": "text",
                "source": "发票号码",
                "group": "header",
                "position": [0.9, 0.9, 0.95, 0.95],
            }
        ],
    }
    header = _sheet(apply_recipe(layout, template), "t-抬头")
    assert header["rows"][1] == ["发票号", "12345678"]
    # semantic miss + far position -> empty value, no crash
    template2 = {
        "name": "t",
        "fields": [
            {
                "name": "不存在",
                "type": "text",
                "source": "不存在的字段",
                "group": "header",
                "position": [0.9, 0.9, 0.95, 0.95],
            }
        ],
    }
    header2 = _sheet(apply_recipe(layout, template2), "t-抬头")
    assert header2["rows"][1] == ["不存在", ""]


def test_old_template_without_position_unchanged():
    layout = LayoutDocument(kvs=[KVItem("发票号码", "12345678")])
    template = {
        "name": "t",
        "fields": [
            {"name": "发票号", "type": "text", "source": "发票号码", "group": "header"}
        ],
    }
    sheets = apply_recipe(layout, template)
    header = _sheet(sheets, "t-抬头")
    assert header["rows"][1] == ["发票号", "12345678"]


def test_kv_by_position_nearest():
    layout = LayoutDocument(
        kvs=[
            KVItem("名称", "个人", (0.2, 0.3, 0.4, 0.35)),
            KVItem("名称", "公司", (0.7, 0.3, 0.9, 0.35)),
        ]
    )
    assert _kv_by_position(layout, [0.7, 0.3, 0.9, 0.35]) == "公司"
    assert _kv_by_position(layout, [0.05, 0.05, 0.1, 0.1]) is None


def test_column_by_position_nearest():
    table = TableBlock(
        name="表", headers=["a", "b", "c"], rows=[], column_positions=[0.0, 0.5, 1.0]
    )
    assert _column_by_position(table, [0.5, 0.0, 0.5, 1.0]) == 1
    assert _column_by_position(table, [0.9, 0.0, 0.9, 1.0]) == 2
    assert _column_by_position(table, [0.25, 0.0, 0.25, 1.0], tolerance=0.1) is None
