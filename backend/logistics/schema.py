"""Standard schema + field mapping for logistics data."""

STANDARD_SCHEMA = {
    "order_id":       {"aliases": ["订单编号","Order ID","销售单号","order_id","orderid","订单号"], "required": True},
    "tracking_no":    {"aliases": ["快递单号","运单号","Tracking#","tracking_no","tracking_number","物流单号"], "required": True},
    "asin":           {"aliases": ["ASIN","asin","产品编码","SKU","sku","商品编码"], "required": False},
    "carrier":        {"aliases": ["快递公司","承运商","Carrier","carrier","物流商","配送商"], "required": False},
    "ship_method":    {"aliases": ["配送方式","Ship Method","物流方式","运输方式"], "required": False},
    "package_size":   {"aliases": ["尺寸","Package Size","件型","Size Tier","尺寸档"], "required": False,
                       "values": ["Standard","Oversize","Extra Large"]},
    "order_created_at":   {"aliases": ["下单时间","创建日期","Order Date","订单日期"], "required": True},
    "ship_confirmed_at":  {"aliases": ["发货时间","Ship Date","发货确认","出库时间"], "required": False},
    "first_scan_at":      {"aliases": ["快递首扫","揽收时间","First Scan","首扫","已取件"], "required": False},
    "delivery_scan_at":   {"aliases": ["签收时间","送达时间","Delivery","妥投","签收"], "required": False},
    "promised_date":      {"aliases": ["承诺送达日","Promised Date","预计送达"], "required": False},
    "origin_country":     {"aliases": ["发货国","Ship From","起始国","原产国"], "required": False},
    "dest_country":       {"aliases": ["目的国","Ship To","Destination"], "required": False},
    "order_value":        {"aliases": ["订单金额","Order Total","金额"], "required": False},
    "is_prime":           {"aliases": ["Prime","is_prime","会员","Prime标识"], "required": False},
}

def suggest_mapping(columns: list[str]) -> dict:
    """AI-assisted: suggest field mapping based on column name similarity."""
    mapping = {}
    for col in columns:
        col_lower = col.lower().replace(" ","").replace("_","").replace("-","")
        for std_field, spec in STANDARD_SCHEMA.items():
            for alias in spec["aliases"]:
                alias_lower = alias.lower().replace(" ","").replace("_","").replace("-","")
                if col_lower == alias_lower or alias_lower in col_lower or col_lower in alias_lower:
                    mapping[std_field] = col
                    break
            if std_field in mapping:
                break
    return mapping

def apply_mapping(df, mapping: dict) -> 'pd.DataFrame':
    """Rename columns to standard names based on mapping."""
    import pandas as pd
    rename = {v: k for k, v in mapping.items() if v in df.columns}
    df2 = df.rename(columns=rename)
    # Fill missing standard columns with None
    for col in STANDARD_SCHEMA:
        if col not in df2.columns:
            df2[col] = None
    return df2
