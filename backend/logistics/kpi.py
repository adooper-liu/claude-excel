"""VTR, OTR, delivery cycle KPI calculation."""
import pandas as pd
import numpy as np

def calculate(df: pd.DataFrame) -> dict:
    """Core KPI calculation for a matched dataset."""
    df = df.copy()
    # Parse dates
    for c in ['order_created_at','ship_confirmed_at','first_scan_at','delivery_scan_at','promised_date']:
        if c in df.columns:
            df[c] = pd.to_datetime(df[c], errors='coerce')

    # Has valid tracking (at least 1 scan)
    has_tracking = df['first_scan_at'].notna() if 'first_scan_at' in df.columns else pd.Series(False, index=df.index)
    vtr = float(has_tracking.sum() / max(len(df), 1))

    # On-time delivery
    if 'delivery_scan_at' in df.columns and 'promised_date' in df.columns:
        on_time = (df['delivery_scan_at'].notna() & df['promised_date'].notna() & (df['delivery_scan_at'] <= df['promised_date']))
        otr = float(on_time.sum() / max(has_tracking.sum(), 1))
    else:
        otr = 0.0

    # Time calculations (hours)
    order_to_ship = ((df['ship_confirmed_at'] - df['order_created_at']).dt.total_seconds() / 3600).mean()
    ship_to_first = ((df['first_scan_at'] - df['ship_confirmed_at']).dt.total_seconds() / 3600).mean()
    first_to_delivery = ((df['delivery_scan_at'] - df['first_scan_at']).dt.total_seconds() / 3600).mean()

    # Segments
    by_carrier = _segment(df, 'carrier', has_tracking, on_time) if 'carrier' in df.columns else {}
    by_size = _segment(df, 'package_size', has_tracking, on_time) if 'package_size' in df.columns else {}
    by_prime = _segment(df, 'is_prime', has_tracking, on_time) if 'is_prime' in df.columns else {}

    return {
        "total_orders": len(df),
        "vtr": round(vtr, 4),
        "otr": round(otr, 4),
        "avg_order_to_ship_h": round(float(order_to_ship), 1) if not np.isnan(order_to_ship) else None,
        "avg_ship_to_first_scan_h": round(float(ship_to_first), 1) if not np.isnan(ship_to_first) else None,
        "avg_first_to_delivery_h": round(float(first_to_delivery), 1) if not np.isnan(first_to_delivery) else None,
        "by_carrier": by_carrier,
        "by_size": by_size,
        "by_prime": by_prime,
        "vtr_target": 0.95,
        "otr_target": 0.90,
        "vtr_status": "pass" if vtr >= 0.95 else "fail",
        "otr_status": "pass" if otr >= 0.90 else "fail",
    }

def _segment(df, col, has_tracking, on_time):
    result = {}
    for val in df[col].dropna().unique():
        mask = df[col] == val
        n = mask.sum()
        if n == 0: continue
        v = float(has_tracking[mask].sum() / n) if n > 0 else 0
        o = float(on_time[mask].sum() / max(has_tracking[mask].sum(), 1)) if has_tracking[mask].sum() > 0 else 0
        result[str(val)] = {"count": int(n), "vtr": round(v,4), "otr": round(o,4)}
    return result
