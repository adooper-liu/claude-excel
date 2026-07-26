"""Anomaly detection for logistics data."""
import pandas as pd
import numpy as np

def detect(df: pd.DataFrame) -> dict:
    """Detect anomalies: timezone issues, missing scans, stale orders, inverted times."""
    df = df.copy()
    anomalies = []
    # Parse dates
    for c in ['order_created_at','ship_confirmed_at','first_scan_at','delivery_scan_at','promised_date']:
        if c in df.columns: df[c] = pd.to_datetime(df[c], errors='coerce')

    for i, row in df.iterrows():
        oid = str(row.get('order_id', f'row_{i}'))

        # Missing first scan (shipped but no tracking)
        if pd.notna(row.get('ship_confirmed_at')) and pd.isna(row.get('first_scan_at')):
            hours_since = (pd.Timestamp.now() - row['ship_confirmed_at']).total_seconds() / 3600
            if hours_since > 24:
                anomalies.append({"order_id": oid, "type": "missing_first_scan", "severity": "high" if hours_since > 72 else "medium", "detail": f"发货 {hours_since:.0f}h 无轨迹", "hours_since_ship": round(hours_since, 1)})

        # Time inversion: first scan before ship
        if pd.notna(row.get('ship_confirmed_at')) and pd.notna(row.get('first_scan_at')):
            if row['first_scan_at'] < row['ship_confirmed_at']:
                anomalies.append({"order_id": oid, "type": "time_inversion", "severity": "medium", "detail": "首扫早于发货", "ship": str(row['ship_confirmed_at']), "scan": str(row['first_scan_at'])})

        # Past promised date, not delivered
        if pd.notna(row.get('promised_date')) and pd.isna(row.get('delivery_scan_at')):
            if row['promised_date'] < pd.Timestamp.now():
                hours_past = (pd.Timestamp.now() - row['promised_date']).total_seconds() / 3600
                anomalies.append({"order_id": oid, "type": "past_promise_not_delivered", "severity": "high" if hours_past > 24 else "medium", "detail": f"承诺日已过 {hours_past:.0f}h", "promised": str(row['promised_date'])})

        # No delivery scan after first scan (stale in transit)
        if pd.notna(row.get('first_scan_at')) and pd.isna(row.get('delivery_scan_at')):
            hours_in_transit = (pd.Timestamp.now() - row['first_scan_at']).total_seconds() / 3600
            if hours_in_transit > 168:  # 7 days
                anomalies.append({"order_id": oid, "type": "stale_in_transit", "severity": "high", "detail": f"在途 {hours_in_transit:.0f}h", "hours_in_transit": round(hours_in_transit, 1)})

    severity_counts = {"high": 0, "medium": 0, "low": 0}
    for a in anomalies:
        severity_counts[a["severity"]] = severity_counts.get(a["severity"], 0) + 1

    return {
        "total_anomalies": len(anomalies),
        "severity_counts": severity_counts,
        "anomalies": anomalies,
    }
