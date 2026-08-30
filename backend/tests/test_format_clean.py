"""Behavioral contract for extraction-time format cleaning."""

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
