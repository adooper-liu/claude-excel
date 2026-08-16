"""gen_dirty_fixtures.py — 按已验证脏特征逐行构造 CSV fixture（Gate 1b 回归测试数据工厂）。

用法：  python dev-tools/gen_dirty_fixtures.py
输出：  samples/packs/cross-border-ecommerce-finance/connector/fixtures/*.csv
验证：  pytest backend/tests/test_connector_load_feed.py -q

每次改 connector/handler、reconcile_tables、SKILL.md 后重跑一次。
"""

from __future__ import annotations

import csv
import io
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "samples" / "packs" / "cross-border-ecommerce-finance" / "connector" / "fixtures"


# ── helpers ──────────────────────────────────────────────────────────

def _write_csv(path: Path, headers: list[str], rows: list[list[str]], encoding: str = "utf-8") -> None:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\n")
    w.writerow(headers)
    for r in rows:
        w.writerow(r)
    FIXTURES.mkdir(parents=True, exist_ok=True)
    path.write_text(buf.getvalue(), encoding=encoding)


def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat()


# ── orders.csv (50 rows, covers 8 dirty-data classes) ────────────────

ORDERS_HEADER = [
    "order_id", "order_date", "platform_sku", "asin",
    "quantity", "item_price", "currency", "order_status", "is_refund",
]

ORDERS_ROWS: list[list[str]] = []

def _o(order_id, order_date, platform_sku, asin="", quantity="1",
       item_price="19.99", currency="USD", order_status="Completed", is_refund="false"):
    ORDERS_ROWS.append([order_id, order_date, platform_sku, asin,
                        quantity, item_price, currency, order_status, is_refund])

# ── 1. SKU 尾空格 ────────────────────────────────────────────────────
_o("O-R1", "2026-01-15", "ABC-01 ", "B001", "2", "29.99", "USD", "Completed", "false")

# ── 2. SKU 小写 ───────────────────────────────────────────────────────
_o("O-R2", "2026-01-15", "abc-01", "B001", "1", "19.99", "USD", "Completed", "false")

# ── 3. 日期格式混排 YYYY/M/D ─────────────────────────────────────────
_o("O-R3", "2026/1/15", "WIDGET-A", "B007", "1", "19.00", "USD", "Completed", "false")

# ── 4. 日期 UTC 时间戳 ─────────────────────────────────────────────────
_o("O-R4", "2026-01-15 00:00:00 UTC", "WIDGET-A", "B007", "1", "19.00", "USD", "Completed", "false")

# ── 5. 金额 $0.00 ─────────────────────────────────────────────────────
_o("O-R5", "2026-01-16", "Widget-B", "B002", "1", "$0.00", "USD", "Completed", "false")

# ── 6. 金额 N/A ───────────────────────────────────────────────────────
_o("O-R6", "2026-01-16", "Widget-C", "B003", "2", "N/A", "USD", "Completed", "false")

# ── 7. 金额空 ─────────────────────────────────────────────────────────
_o("O-R7", "2026-01-17", "Widget-D", "B004", "1", "", "USD", "Completed", "false")

# ── 8. 退款行（状态 Refunded + 负金额） ───────────────────────────────
_o("O-R8", "2026-01-18", "Widget-A", "B001", "1", "-29.99", "USD", "Refunded", "true")

# ── 9. 部分退款（同订单拆两行，一行正常，一行退款）────────────────────
_o("O-R9a", "2026-01-19", "Widget-E", "B005", "1", "-15.00", "USD", "PartialRefund", "true")
_o("O-R9b", "2026-01-19", "Widget-E", "B005", "1", "30.00", "USD", "Completed", "false")

# ── 10. 混合币种 GBP ──────────────────────────────────────────────────
_o("O-R10", "2026-01-20", "Widget-F", "B006", "1", "25.00", "GBP", "Completed", "false")

# ── 11. 长 order-id（15 位，Excel 打开变科学计数法） ─────────────────
_o("O-123456789012345", "2026-01-21", "ABC-01", "B001", "1", "19.99", "USD", "Completed", "false")

# ── 12. 状态 Cancelled ────────────────────────────────────────────────
_o("O-R12", "2026-01-22", "Widget-G", "B008", "1", "12.00", "USD", "Cancelled", "false")

# ── 13. 重复行（和 R1 完全相同） ──────────────────────────────────────
_o("O-R1", "2026-01-15", "ABC-01 ", "B001", "2", "29.99", "USD", "Completed", "false")

# ── 14. 孤行 SKU（广告表不匹配）───────────────────────────────────────
_o("O-R14", "2026-01-23", "XYZ-99-orphan", "B099", "1", "49.99", "USD", "Completed", "false")

# ── EUR 币种 ──────────────────────────────────────────────────────────
_o("O-R15", "2026-01-24", "Widget-H", "B009", "1", "18.00", "EUR", "Completed", "false")

# ── 正常行 15–50 ──────────────────────────────────────────────────────
for i in range(16, 51):
    sku = f"SKU-{i:03d}"
    asin = f"B{i:03d}"
    date = f"2026-01-{min(i, 28):02d}"
    cur = "USD" if i % 4 != 0 else ("GBP" if i % 4 == 1 else "EUR")
    _o(f"O-N{i:03d}", date, sku, asin, "1", f"{9.99 + i * 0.5:.2f}", cur, "Completed", "false")


# ── ads.csv (40 rows, covers ad-specific dirty features) ──────────────

ADS_HEADER = [
    "ad_date", "platform_sku", "campaign_id",
    "spend", "currency", "impressions", "clicks",
]

ADS_ROWS: list[list[str]] = []

def _a(ad_date, platform_sku, campaign_id="cmp-default",
       spend="5.00", currency="USD", impressions="100", clicks="5"):
    ADS_ROWS.append([ad_date, platform_sku, campaign_id,
                     spend, currency, impressions, clicks])

# ── 1. SKU 尾空格 ────────────────────────────────────────────────────
_a("2026-01-15", "ABC-01 ", "cmp-sku", "10.00", "USD", "200", "12")

# ── 2. SKU 大小写混合 ─────────────────────────────────────────────────
_a("2026-01-15", "ABC-01", "cmp-sku", "5.00", "USD", "150", "8")

# ── 3. 日期 / 格式 ────────────────────────────────────────────────────
_a("2026/01/15", "widget-a", "cmp-sku", "2.00", "USD", "80", "4")

# ── 4. 金额 $0.00 ─────────────────────────────────────────────────────
_a("2026-01-16", "Widget-B", "cmp-default", "$0.00", "USD", "50", "3")

# ── 5. 金额 N/A ───────────────────────────────────────────────────────
_a("2026-01-16", "Widget-C", "cmp-default", "N/A", "USD", "60", "4")

# ── 6. impressions / clicks 可选列空值 ────────────────────────────────
_a("2026-01-17", "Widget-D", "cmp-default", "7.50", "USD", "", "")

# ── 7. impressions N/A ────────────────────────────────────────────────
_a("2026-01-18", "Widget-A", "cmp-sku", "3.00", "USD", "N/A", "N/A")

# ── 8. EUR 币种（和订单 USD 不同） ────────────────────────────────────
_a("2026-01-19", "Widget-E", "cmp-sku", "4.00", "EUR", "120", "7")

# ── 9. campaign 含中文+emoji ──────────────────────────────────────────
_a("2026-01-20", "Widget-F", "冬季促销🔥", "6.00", "USD", "90", "6")

# ── 10. clicks 为 0 ───────────────────────────────────────────────────
_a("2026-01-21", "ABC-01", "cmp-sku", "1.50", "USD", "10", "0")

# ── 11. SKU 缺失→ 订单不匹配 ─────────────────────────────────────────
_a("2026-01-22", "XYZ-99-missing", "cmp-default", "8.00", "USD", "200", "10")

# ── 12. 归因偏移（ad_date 比 order_date 早 3 天） ─────────────────────
_a("2026-01-12", "SKU-016", "cmp-default", "3.00", "USD", "50", "3")
_a("2026-01-12", "SKU-017", "cmp-default", "4.00", "USD", "60", "4")
_a("2026-01-12", "SKU-018", "cmp-default", "5.00", "USD", "70", "5")

# ── 正常行 13–40 ──────────────────────────────────────────────────────
for i in range(13, 41):
    sku = f"SKU-{i + 10:03d}" if i > 15 else f"SKU-{i:03d}"
    date = f"2026-01-{min(i, 28):02d}"
    cur = "USD" if i % 3 != 0 else "EUR"
    _a(date, sku, f"cmp-{i:03d}", f"{1.0 + i * 0.25:.2f}", cur, f"{50 + i * 10}", f"{2 + i % 5}")


# ── 假设参数.csv ──────────────────────────────────────────────────────

PARAMS_HEADER = ["参数", "值", "说明"]
PARAMS_ROWS = [
    ["汇率_USD_CNY", "7.2", "用户填写"],
    ["汇率_GBP_CNY", "9.0", "用户填写"],
    ["汇率_EUR_CNY", "7.8", "用户填写"],
    ["佣金率_%", "15%", "亚马逊多数类目"],
    ["FBA_基础_$", "3.22", "小标准件（2026）"],
    ["FBA_燃油附加_%", "3.5%", "2026-04-17 起"],
    ["退款率_%", "8%", "普通类目均值"],
    ["目标净利率_%", "10%", "标红阈值"],
]


# ── entry point ───────────────────────────────────────────────────────

def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)

    _write_csv(FIXTURES / "orders_dirty.csv", ORDERS_HEADER, ORDERS_ROWS)
    print(f"[OK] orders_dirty.csv — {len(ORDERS_ROWS)} rows")

    _write_csv(FIXTURES / "ads_dirty.csv", ADS_HEADER, ADS_ROWS)
    print(f"[OK] ads_dirty.csv — {len(ADS_ROWS)} rows")

    _write_csv(FIXTURES / "假设参数.csv", PARAMS_HEADER, PARAMS_ROWS)
    print(f"[OK] 假设参数.csv — {len(PARAMS_ROWS)} rows")

    print(f"\n  -> {FIXTURES}")
    print("  -> Gate 1b 录屏前: cp orders_dirty.csv orders.csv && cp ads_dirty.csv ads.csv")
    print("  -> 测完恢复: git checkout -- samples/packs/.../connector/fixtures/orders.csv ads.csv")
    print(f"  generated at {_now()}")


if __name__ == "__main__":
    main()