"""user.profit_assumptions — pure calculation, no network, no secrets."""

from __future__ import annotations

import json
import sys

# Default assumption rates (user-provided / illustrative; not market benchmarks).
DEFAULTS = {
    "referral_rate": 0.15,
    "fba_fee_rate": 0.12,
    "return_rate": 0.03,
    "ad_rate": 0.08,
    "cogs_rate": 0.35,
    "inbound_rate": 0.02,
    "storage_rate": 0.01,
    "fx_loss_rate": 0.01,
    "vat_rate": 0.0,
    "duty_rate": 0.0,
    "other_rate": 0.02,
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
