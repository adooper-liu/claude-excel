"""Behavioral contract for layout extraction (word boxes + doc-parse payloads)."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import layout_extract  # noqa: E402


def _word(left, top, text, width=None, height=16, conf=90):
    return {
        "left": left,
        "top": top,
        "width": width if width is not None else max(10, len(text) * 10),
        "height": height,
        "conf": conf,
        "text": text,
    }


def test_cluster_words_builds_table_and_kvs():
    words = [
        _word(10, 10, "发票号码:", width=55),
        _word(110, 10, "12345678", width=70),
        _word(10, 30, "开票日期:", width=55),
        _word(110, 30, "2026-08-30", width=80),
        _word(10, 70, "品名", width=28),
        _word(120, 70, "金额", width=28),
        _word(240, 70, "税率", width=28),
        _word(10, 90, "A产品", width=30),
        _word(120, 90, "1,234.56", width=40),
        _word(240, 90, "13%", width=24),
        _word(10, 110, "B产品", width=30),
        _word(120, 110, "56.00", width=40),
        _word(240, 110, "13%", width=24),
    ]
    layout = layout_extract.cluster_words(words)
    assert layout.kv("发票号码") == "12345678"
    assert layout.kv("开票日期") == "2026-08-30"
    assert len(layout.tables) == 1
    table = layout.tables[0]
    assert table.headers == ["品名", "金额", "税率"]
    assert table.rows == [
        ["A产品", "1,234.56", "13%"],
        ["B产品", "56.00", "13%"],
    ]


def test_cluster_words_drops_low_confidence_noise():
    words = [
        _word(10, 10, "发票号码:", width=55),
        _word(110, 10, "12345678", width=70),
        _word(10, 30, "噪点", width=28, conf=5),
        _word(10, 70, "品名", width=28),
        _word(120, 70, "金额", width=28),
        _word(240, 70, "税率", width=28),
        _word(10, 90, "A产品", width=30),
        _word(120, 90, "1,234.56", width=40),
        _word(240, 90, "13%", width=24),
    ]
    layout = layout_extract.cluster_words(words)
    assert layout.kv("发票号码") == "12345678"
    assert layout.kv("噪点") is None
    assert len(layout.tables) == 1
    assert layout.tables[0].headers == ["品名", "金额", "税率"]
    assert layout.tables[0].rows == [["A产品", "1,234.56", "13%"]]


def test_doc_parse_to_layout_skips_markdown_separator():
    markdown = (
        "| 品名 | 金额 | 税率 |\n"
        "| --- | --- | --- |\n"
        "| A产品 | 1,234.56 | 13% |\n"
        "| B产品 | 56.00 | 13% |\n"
    )
    layout = layout_extract.doc_parse_to_layout(markdown)
    assert len(layout.tables) == 1
    table = layout.tables[0]
    assert table.headers == ["品名", "金额", "税率"]
    assert table.rows == [
        ["A产品", "1,234.56", "13%"],
        ["B产品", "56.00", "13%"],
    ]


def test_doc_parse_to_layout_extracts_kv():
    layout = layout_extract.doc_parse_to_layout(
        "发票号码: 12345678\n开票日期：2026-08-30"
    )
    assert layout.kv("发票号码") == "12345678"
    assert layout.kv("开票日期") == "2026-08-30"


def test_doc_parse_to_layout_empty_for_plain_text():
    layout = layout_extract.doc_parse_to_layout(
        "这是一段没有任何表格和键值对的纯文本，也没有冒号分隔。"
    )
    assert layout.kvs == []
    assert layout.tables == []

