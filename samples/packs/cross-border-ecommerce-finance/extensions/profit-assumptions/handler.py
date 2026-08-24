"""user.profit_assumptions — pure calculation, no network, no secrets.

Fallback defaults when 假设参数 sheet has not been created yet.
Canonical source of truth: SKILL.md Appendix A / 假设参数.csv.
"""

from __future__ import annotations

import json
import sys

# Aligned with SKILL.md Appendix A and 假设参数.csv (2026-08 revision).
DEFAULTS = {
    "fx_rate_usd": 7.2,
    "referral_rate": 0.15,
    "return_rate": 0.08,
    "fba_base_usd": 3.22,
    "fba_fuel_surcharge_rate": 0.035,
    "storage_usd": 1.50,
    "payment_fee_rate": 0.025,
    "target_margin_rate": 0.10,
    "ad_tacos_ref": 0.08,
}


def main() -> None:
    raw = sys.stdin.read()
    try:
        params = json.loads(raw or "{}")
    except json.JSONDecodeError:
        params = {}
    asins = params.get("asins") or []
    if not isinstance(asins, list):
        asins = []
    cleaned = [str(a).strip() for a in asins if str(a).strip()]
    rows = []
    for asin in cleaned:
        row = {"asin": asin, **DEFAULTS}
        rows.append(row)
    out = {"assumptions": rows, "count": len(rows), "source": "user.profit_assumptions"}
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
