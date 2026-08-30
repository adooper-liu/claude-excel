"""Behavioral contract for extraction-time format cleaning."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from format_clean import apply_template, clean_date, clean_number, is_null


def test_is_null_matches_empty_and_configured_markers():
    assert is_null(None, [])
    assert is_null("   ", [])
    assert is_null(" N/A ", ["N/A", "-"])
    assert not is_null(0, ["N/A"])


def test_clean_number_supports_european_and_american_formats():
    assert clean_number("1.234,56", "eu", ["€"]) == 1234.56
    assert clean_number("€ 1.234,56", "eu", ["€"]) == 1234.56
    assert clean_number("1,234.56", "us", []) == 1234.56
    assert clean_number("￥1,234.56", "us", ["￥"]) == 1234.56


def test_clean_number_returns_none_for_null_or_dirty_values():
    assert clean_number("N/A", "us", [], ["N/A"]) is None
    assert clean_number("", "us", []) is None
    assert clean_number("abc", "us", []) is None


def test_clean_date_parses_format_and_preserves_plain_text_when_no_format():
    assert clean_date("9/4/2018", "%m/%d/%Y") == "2018-09-04"
    assert clean_date("2026/08/30", "%Y/%m/%d") == "2026-08-30"
    assert clean_date("9/4/2018", "%Y/%m/%d") is None
    assert clean_date("9/4/2018", "") == "9/4/2018"


def test_apply_template_replaces_header_and_aligns_cleaned_columns():
    template = {
        "fields": [
            {"name": "名称", "type": "text"},
            {
                "name": "金额",
                "type": "number",
                "format": {"numberStyle": "eu", "stripSymbols": ["€"], "nullValues": ["-"]},
            },
            {"name": "日期", "type": "date", "format": {"dateFormat": "%m/%d/%Y"}},
            {"name": "缺失", "type": "text"},
        ]
    }
    rows = [
        ["Product", "Amount", "Date"],
        ["Widget", "€1.234,56", "09/04/2018"],
        ["Service", "-", ""],
    ]

    assert apply_template(rows, template) == [
        ["名称", "金额", "日期", "缺失"],
        ["Widget", 1234.56, "2018-09-04", ""],
        ["Service", None, None, ""],
    ]


def test_apply_template_keeps_first_row_when_headerless():
    template = {
        "fields": [
            {"name": "品名", "type": "text"},
            {"name": "金额", "type": "number", "format": {"numberStyle": "us"}},
        ]
    }
    rows = [
        ["Widget", "1,234.56"],
        ["Service", "56.00"],
    ]

    assert apply_template(rows, template, has_header=False) == [
        ["品名", "金额"],
        ["Widget", 1234.56],
        ["Service", 56.0],
    ]


def test_apply_template_strips_percent_and_amount_symbols():
    template = {
        "fields": [
            {"name": "折扣", "type": "percent"},
            {"name": "金额", "type": "amount", "format": {"numberStyle": "us"}},
        ]
    }
    rows = [
        ["Rate", "Total"],
        ["12%", "$1,234.56"],
    ]

    assert apply_template(rows, template) == [
        ["折扣", "金额"],
        [12.0, 1234.56],
    ]

from layout_doc import KVItem, LayoutDocument, TableBlock
from format_clean import apply_recipe, normalize_key


def _invoice_layout() -> LayoutDocument:
    return LayoutDocument(
        kvs=[KVItem("发票号码", "12345678"), KVItem("价税合计", "￥113.00")],
        tables=[
            TableBlock(
                name="表",
                headers=["品名", "金额"],
                rows=[["A", "1,234.56"], ["B", "56.00"]],
            )
        ],
    )


def test_apply_recipe_detail_sheet_cleans_by_source():
    template = {
        "name": "发票",
        "fields": [
            {"name": "品名", "type": "text", "source": "品名", "group": "detail"},
            {
                "name": "金额",
                "type": "amount",
                "source": "金额",
                "group": "detail",
                "format": {"numberStyle": "us"},
            },
        ],
    }
    sheets = apply_recipe(_invoice_layout(), template)
    assert sheets[0]["name"] == "发票-明细"
    assert sheets[0]["rows"] == [
        ["品名", "金额"],
        ["A", 1234.56],
        ["B", 56.0],
    ]


def test_apply_recipe_header_sheet_from_kvs():
    template = {
        "name": "发票",
        "fields": [
            {"name": "发票号码", "type": "text", "source": "发票号码", "group": "header"},
            {
                "name": "价税合计",
                "type": "amount",
                "source": "价税合计",
                "group": "header",
                "format": {"numberStyle": "us"},
            },
        ],
    }
    sheets = apply_recipe(_invoice_layout(), template)
    header = sheets[1]
    assert header["name"] == "发票-抬头"
    assert ["发票号码", "12345678"] in header["rows"]
    assert ["价税合计", 113.0] in header["rows"]


def test_apply_recipe_aligns_by_source_when_column_order_scrambled():
    template = {
        "name": "发票",
        "fields": [
            {
                "name": "金额",
                "type": "number",
                "source": "金额",
                "group": "detail",
                "format": {"numberStyle": "us"},
            },
            {"name": "品名", "type": "text", "source": "品名", "group": "detail"},
        ],
    }
    sheets = apply_recipe(_invoice_layout(), template)
    assert sheets[0]["rows"] == [
        ["金额", "品名"],
        [1234.56, "A"],
        [56.0, "B"],
    ]


def test_apply_recipe_legacy_template_single_sheet():
    template = {
        "name": "发票",
        "fields": [
            {"name": "品名", "type": "text"},
            {"name": "金额", "type": "number", "format": {"numberStyle": "us"}},
        ],
    }
    sheets = apply_recipe(_invoice_layout(), template)
    assert len(sheets) == 1
    assert sheets[0]["name"] == "发票-明细"
    assert sheets[0]["rows"] == [
        ["品名", "金额"],
        ["A", 1234.56],
        ["B", 56.0],
    ]


def test_apply_recipe_returns_header_sheet_even_without_header_fields():
    template = {
        "name": "发票",
        "fields": [{"name": "品名", "type": "text", "source": "品名", "group": "detail"}],
    }
    sheets = apply_recipe(_invoice_layout(), template)
    assert len(sheets) == 2
    assert sheets[1]["name"] == "发票-抬头"
    assert sheets[1]["rows"] == [["字段", "值"]]


def test_normalize_key_whitespace_and_width():
    assert normalize_key("发 票 号　码") == "发票号码"
    assert normalize_key("ＡＭＯＵＮＴ") == "amount"

from format_clean import clean_chinese_amount, normalize_ocr_text


def test_normalize_ocr_text_full_width_and_internal_spaces():
    assert normalize_ocr_text("１ ２３４.５６") == "1234.56"
    assert normalize_ocr_text("１ ２３４．５６") == "1234.56"
    assert normalize_ocr_text("  abc  ") == "  abc  "


def test_clean_chinese_amount_parses_uppercase_amounts():
    assert clean_chinese_amount("壹佰贰拾叁元肆角伍分") == 123.45
    assert clean_chinese_amount("壹佰贰拾叁元整") == 123.0
    assert clean_chinese_amount("123.45元") == 123.45
    assert clean_chinese_amount("￥壹佰贰拾叁元") == 123.0
    assert clean_chinese_amount("人民币伍角") == 0.5
    assert clean_chinese_amount("不是金额") is None
    assert clean_chinese_amount("") is None


def test_clean_date_supports_multiple_formats():
    assert clean_date("2018/9/4", "%Y/%m/%d;%Y-%m-%d") == "2018-09-04"
    assert clean_date("2018-09-04", "%Y/%m/%d;%Y-%m-%d") == "2018-09-04"
    assert clean_date("2018/9/4", "%Y.%m.%d") is None


def test_clean_number_normalizes_ocr_text_at_entry():
    assert clean_number("1 234,56", "eu", []) == 1234.56
    assert clean_number("１,２３４．５６", "us", []) == 1234.56

def test_apply_recipe_header_source_uses_occurrence():
    from layout_doc import KVItem, LayoutDocument

    layout = LayoutDocument(
        kvs=[KVItem("名称", "购买方-个人"), KVItem("名称", "销售方-京东")]
    )
    template = {
        "name": "发票",
        "fields": [
            {"name": "购买方名称", "type": "text", "source": "名称#1", "group": "header"},
            {"name": "销售方名称", "type": "text", "source": "名称#2", "group": "header"},
        ],
    }
    sheets = apply_recipe(layout, template)
    header = next(sheet for sheet in sheets if sheet["name"].endswith("抬头"))
    values = dict((str(r[0]), r[1]) for r in header["rows"][1:])
    assert values["购买方名称"] == "购买方-个人"
    assert values["销售方名称"] == "销售方-京东"
