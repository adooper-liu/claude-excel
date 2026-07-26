"""Carrier performance comparison."""
import pandas as pd

def compare(df: pd.DataFrame) -> dict:
    """Compare carriers by VTR, OTR, avg delivery time."""
    df = df.copy()
    for c in ['order_created_at','ship_confirmed_at','first_scan_at','delivery_scan_at']:
        if c in df.columns: df[c] = pd.to_datetime(df[c], errors='coerce')

    has_tracking = df['first_scan_at'].notna()
    if 'delivery_scan_at' in df.columns and 'promised_date' in df.columns:
        on_time = df['delivery_scan_at'].notna() & df['promised_date'].notna() & (df['delivery_scan_at'] <= df['promised_date'])
    else:
        on_time = pd.Series(False, index=df.index)

    carriers = {}
    if 'carrier' not in df.columns:
        return {"carriers": [], "note": "No carrier column"}

    for name in df['carrier'].dropna().unique():
        mask = df['carrier'] == name
        n = mask.sum()
        if n == 0: continue
        v = float(has_tracking[mask].sum() / n)
        o = float(on_time[mask].sum() / max(has_tracking[mask].sum(), 1)) if has_tracking[mask].sum() > 0 else 0
        avg_h = float((df.loc[mask, 'delivery_scan_at'] - df.loc[mask, 'first_scan_at']).dt.total_seconds().mean() / 3600) if 'delivery_scan_at' in df.columns and 'first_scan_at' in df.columns else 0
        carriers[str(name)] = {
            "orders": int(n),
            "vtr": round(v, 4),
            "otr": round(o, 4),
            "avg_delivery_h": round(avg_h, 1) if avg_h > 0 else None,
            "vtr_status": "pass" if v >= 0.95 else "fail",
            "otr_status": "pass" if o >= 0.90 else "fail",
        }
    return {"carriers": sorted(carriers.items(), key=lambda x: x[1]['orders'], reverse=True)}
