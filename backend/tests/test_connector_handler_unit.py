"""Unit tests for connector-csv-local/handler.py — alias mapping, encoding, coercion."""

import sys
from pathlib import Path

import pytest

PACK_DIR = (
    Path(__file__).resolve().parents[2]
    / "samples"
    / "packs"
    / "cross-border-ecommerce-finance"
)
HANDLER_DIR = PACK_DIR / "extensions" / "connector-csv-local"
sys.path.insert(0, str(HANDLER_DIR))

import handler  # noqa: E402


# ── Alias mapping ──────────────────────────────────────────────


class TestAliasLookup:
    def test_qty_maps_to_quantity_not_on_hand(self):
        """qty should map to quantity (orders), not on_hand (inventory)."""
        assert handler.ALIAS_LOOKUP[handler._normalize_header("qty")] == "quantity"

    def test_on_hand_aliases(self):
        lookup = handler.ALIAS_LOOKUP
        assert lookup[handler._normalize_header("on_hand")] == "on_hand"
        assert lookup[handler._normalize_header("on_hand_qty")] == "on_hand"
        assert lookup[handler._normalize_header("可用库存")] == "on_hand"
        assert lookup[handler._normalize_header("库存")] == "on_hand"

    def test_sku_aliases(self):
        for alias in ("sku", "SKU", "seller_sku", "platform_sku"):
            assert handler.ALIAS_LOOKUP[handler._normalize_header(alias)] == "platform_sku"

    def test_no_duplicate_canonical_for_same_alias(self):
        """Every raw alias should resolve to exactly one canonical name."""
        seen: dict[str, str] = {}
        for canonical, aliases in handler.HEADER_ALIASES.items():
            for alias in aliases:
                key = handler._normalize_header(alias)
                if key in seen:
                    assert seen[key] == canonical, (
                        f"alias '{alias}' maps to both '{seen[key]}' and '{canonical}'"
                    )
                seen[key] = canonical


# ── Encoding detection ─────────────────────────────────────────


class TestDecodeBytes:
    def test_utf8_bom(self):
        text = handler._decode_bytes(b"\xef\xbb\xbfhello")
        assert text == "hello"

    def test_gbk(self):
        raw = "订单号,日期".encode("gbk")
        text = handler._decode_bytes(raw)
        assert "订单号" in text

    def test_latin1_fallback(self):
        raw = bytes(range(128, 256))
        text = handler._decode_bytes(raw)
        assert len(text) == 128


# ── SKU normalization ──────────────────────────────────────────


class TestNormalizeSku:
    @pytest.mark.parametrize("input_val,expected", [
        ("ABC-01 ", "abc-01"),
        (" Widget-A", "widget-a"),
        ("", ""),
        (None, ""),
    ])
    def test_normalize(self, input_val, expected):
        assert handler._normalize_sku(input_val) == expected


# ── Date normalization ─────────────────────────────────────────


class TestNormalizeDate:
    def test_iso_truncation(self):
        assert handler._normalize_date("2026-01-15 00:00:00 UTC") == "2026-01-15"

    def test_slash_format_passthrough(self):
        assert handler._normalize_date("2026/1/15") == "2026/1/15"

    def test_empty(self):
        assert handler._normalize_date("") == ""
        assert handler._normalize_date(None) == ""


# ── Number coercion ────────────────────────────────────────────


class TestCoerceNumber:
    @pytest.mark.parametrize("input_val,expected", [
        (10, 10),
        (3.14, 3.14),
        ("29.99", 29.99),
        ("$0.00", "$0.00"),
        ("N/A", "N/A"),
        ("", ""),
        (None, ""),
        ("1,234.56", 1234.56),
        ("100", 100),
    ])
    def test_coerce(self, input_val, expected):
        assert handler._coerce_number(input_val) == expected


# ── Bool coercion ──────────────────────────────────────────────


class TestCoerceBool:
    @pytest.mark.parametrize("input_val,expected", [
        ("true", True),
        ("True", True),
        ("1", True),
        ("yes", True),
        ("是", True),
        ("false", False),
        ("0", False),
        ("", False),
        (None, False),
    ])
    def test_coerce(self, input_val, expected):
        assert handler._coerce_bool(input_val) == expected


# ── Row mapping integration ────────────────────────────────────


class TestMapRawRow:
    def test_order_row(self):
        raw = {
            "order_id": "O-001",
            "order_date": "2026-01-15 10:00:00",
            "sku": " ABC-01 ",
            "qty": "3",
            "item_price": "29.99",
            "currency": "USD",
            "is_refund": "false",
        }
        mapped = handler._map_raw_row(raw)
        assert mapped["order_id"] == "O-001"
        assert mapped["platform_sku"] == "abc-01"
        assert mapped["quantity"] == 3
        assert mapped["item_price"] == 29.99
        assert mapped["is_refund"] is False
        assert mapped["biz_date"] == "2026-01-15"

    def test_ad_row(self):
        raw = {
            "ad_date": "2026-01-15",
            "platform_sku": "Widget-B",
            "spend": "5.50",
        }
        mapped = handler._map_raw_row(raw)
        assert mapped["platform_sku"] == "widget-b"
        assert mapped["spend"] == 5.5
        assert mapped["biz_date"] == "2026-01-15"

    def test_inventory_row_on_hand(self):
        raw = {
            "on_hand": "150",
            "warehouse": "FBA-US",
        }
        mapped = handler._map_raw_row(raw)
        assert "on_hand" in mapped
        assert "quantity" not in mapped
