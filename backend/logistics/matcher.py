"""Order ↔ tracking matching engine."""
import pandas as pd

def match(orders: pd.DataFrame, tracking: pd.DataFrame,
          on: list[str] = None) -> dict:
    """Match orders to tracking records. Returns matched + unmatched + confidence."""
    if on is None:
        on = ['order_id']
        if 'tracking_no' in orders.columns and 'tracking_no' in tracking.columns:
            on.append('tracking_no')
    # Left join
    merged = orders.merge(tracking, on=on, how='left', suffixes=('','_track'))
    matched = merged[merged['tracking_no_track'].notna()] if 'tracking_no_track' in merged.columns else merged.dropna(subset=[c for c in tracking.columns if c not in on])
    unmatched = orders[~orders['order_id'].isin(matched['order_id'])]
    return {
        "total_orders": len(orders),
        "matched": len(matched),
        "unmatched": len(unmatched),
        "match_rate": round(len(matched) / max(len(orders), 1), 4),
        "matched_df": matched,
        "unmatched_orders": unmatched[['order_id']].to_dict('records') if len(unmatched) > 0 else [],
        "confidence": "high" if len(matched) / max(len(orders),1) > 0.95 else ("medium" if len(matched) / max(len(orders),1) > 0.8 else "low"),
    }

def time_window_match(orders: pd.DataFrame, tracking: pd.DataFrame,
                      time_col_order: str, time_col_tracking: str,
                      window_hours: int = 72) -> dict:
    """Match within a time window (orders within N hours of tracking scan)."""
    orders = orders.copy(); tracking = tracking.copy()
    orders[time_col_order] = pd.to_datetime(orders[time_col_order], errors='coerce')
    tracking[time_col_tracking] = pd.to_datetime(tracking[time_col_tracking], errors='coerce')
    results = []
    for _, order in orders.iterrows():
        window_start = order[time_col_order] - pd.Timedelta(hours=window_hours)
        window_end = order[time_col_order] + pd.Timedelta(hours=window_hours)
        candidates = tracking[(tracking[time_col_tracking] >= window_start) & (tracking[time_col_tracking] <= window_end)]
        if len(candidates) > 0:
            results.append({**order.to_dict(), 'tracking_match': candidates.iloc[0].to_dict(), 'match_method': 'time_window'})
    return {"matched": len(results), "total": len(orders), "results": results}
