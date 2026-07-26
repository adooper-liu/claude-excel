"""Excel report generation."""
import pandas as pd
import io

def generate(kpi_result: dict, anomaly_result: dict, carrier_result: dict, matched_df: pd.DataFrame) -> bytes:
    """Generate XLSX report, return bytes for download."""
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine='openpyxl') as writer:
        # Sheet 1: KPI Summary
        pd.DataFrame([{
            "指标": "Total Orders", "值": kpi_result.get("total_orders"),
        },{
            "指标": "VTR", "值": f"{kpi_result.get('vtr',0)*100:.1f}%", "目标": "≥95%", "状态": kpi_result.get("vtr_status"),
        },{
            "指标": "OTR", "值": f"{kpi_result.get('otr',0)*100:.1f}%", "目标": "≥90%", "状态": kpi_result.get("otr_status"),
        },{
            "指标": "订单→发货 (h)", "值": kpi_result.get("avg_order_to_ship_h"),
        },{
            "指标": "发货→首扫 (h)", "值": kpi_result.get("avg_ship_to_first_scan_h"),
        },{
            "指标": "首扫→送达 (h)", "值": kpi_result.get("avg_first_to_delivery_h"),
        }]).to_excel(writer, sheet_name="KPI", index=False)

        # Sheet 2: By Carrier
        carriers = [{"carrier": c[0], **c[1]} for c in carrier_result.get("carriers", [])]
        if carriers:
            pd.DataFrame(carriers).to_excel(writer, sheet_name="承运商对比", index=False)

        # Sheet 3: Anomalies
        if anomaly_result.get("anomalies"):
            pd.DataFrame(anomaly_result["anomalies"]).to_excel(writer, sheet_name="异常订单", index=False)

        # Sheet 4: Matched Data
        matched_df.to_excel(writer, sheet_name="匹配数据", index=False)

    return output.getvalue()
