"""Behavioral contract for the layout document model."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from layout_doc import KVItem, LayoutDocument, TableBlock  # noqa: E402


def test_to_dict_from_dict_round_trip():
    doc = LayoutDocument(
        kvs=[KVItem("发票号码", "12345678"), KVItem("价税合计", "113.00")],
        tables=[
            TableBlock(
                name="明细",
                headers=["品名", "金额"],
                rows=[["A", "1,234.56"], ["B", "56.00"]],
            )
        ],
        raw_text="发票号码: 12345678",
        engine="rapid",
    )
    assert LayoutDocument.from_dict(doc.to_dict()) == doc
    assert LayoutDocument.from_dict(doc.to_dict()).engine == "rapid"


def test_empty_document_has_no_first_table():
    assert LayoutDocument().first_table() is None
    assert LayoutDocument(tables=[]).first_table() is None


def test_first_table_prefers_larger_table():
    small = TableBlock(name="小", headers=["a"], rows=[["1"]])
    large = TableBlock(name="大", headers=["a", "b"], rows=[["1", "2"], ["3", "4"]])
    doc = LayoutDocument(tables=[small, large])
    assert doc.first_table() == large


def test_column_normalizes_full_and_half_width_whitespace():
    table = TableBlock(name="t", headers=["发 票 号 码", "金\u3000额", "AMOUNT"])
    assert table.column("发票号码") == 0
    assert table.column("金额") == 1
    assert table.column("amount") == 2
    assert table.column("不存在") is None


def test_kv_normalized_lookup():
    doc = LayoutDocument(kvs=[KVItem("发票 号码", "12345678")])
    assert doc.kv("发票号码") == "12345678"
    assert doc.kv("不存在") is None

def test_kv_supports_occurrence_suffix():
    from layout_doc import KVItem, LayoutDocument

    layout = LayoutDocument(
        kvs=[KVItem("名称", "购买方-个人"), KVItem("名称", "销售方-京东"), KVItem("发票号码", "123")]
    )
    assert layout.kv("名称") == "购买方-个人"
    assert layout.kv("名称#1") == "购买方-个人"
    assert layout.kv("名称#2") == "销售方-京东"
    assert layout.kv("名称#3") is None
    assert layout.kv("发票号码") == "123"
