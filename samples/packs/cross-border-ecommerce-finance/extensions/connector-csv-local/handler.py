"""user.connector_load_feed — Phase 1 csv_local: fixtures → canonical Pack columns."""

from __future__ import annotations

import base64
import csv
import hashlib
import json
import os
import sys
from pathlib import Path
from typing import Any

FEED_FILES = {
    "orders": "orders.csv",
    "ads": "ads.csv",
    "inventory": "inventory.csv",
}

HEADER_ALIASES: dict[str, list[str]] = {
    "order_id": ["order_id", "订单号", "orderid"],
    "order_date": ["order_date", "order date", "成交日", "biz_date"],
    "platform_sku": ["platform_sku", "sku", "SKU", "seller_sku"],
    "asin": ["asin", "ASIN"],
    "quantity": ["quantity", "qty", "数量"],
    "item_price": ["item_price", "price", "单价", "item price"],
    "currency": ["currency", "币种"],
    "order_status": ["order_status", "status", "订单状态"],
    "is_refund": ["is_refund", "refund", "退款"],
    "ad_date": ["ad_date", "click_date", "date", "点击日"],
    "campaign_id": ["campaign_id", "campaign"],
    "spend": ["spend", "cost", "广告费"],
    "impressions": ["impressions", "展示"],
    "clicks": ["clicks", "点击"],
    "on_hand": ["on_hand", "qty", "库存"],
    "warehouse": ["warehouse", "仓"],
}


def _config_dir() -> Path:
    prof = os.environ.get("USERPROFILE") or os.environ.get("HOME") or ""
    return Path(prof) / ".claude-excel-web"


def _normalize_header(name: str) -> str:
    return str(name or "").strip().lower().replace(" ", "_")


def _build_alias_lookup() -> dict[str, str]:
    out: dict[str, str] = {}
    for canonical, aliases in HEADER_ALIASES.items():
        for alias in aliases:
            out[_normalize_header(alias)] = canonical
        out[_normalize_header(canonical)] = canonical
    return out


ALIAS_LOOKUP = _build_alias_lookup()


def _normalize_sku(value: Any) -> str:
    return str(value or "").strip().lower()


def _normalize_date(value: Any) -> str:
    s = str(value or "").strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return s


def _coerce_number(value: Any) -> float | int | str:
    if value is None or value == "":
        return ""
    if isinstance(value, (int, float)):
        return value
    s = str(value).strip().replace(",", "")
    if not s:
        return ""
    try:
        f = float(s)
        if f.is_integer():
            return int(f)
        return f
    except ValueError:
        return s


def _coerce_bool(value: Any) -> bool:
    s = str(value or "").strip().lower()
    return s in ("1", "true", "yes", "y", "是")


def _load_schema(pack_dir: Path, feed: str) -> tuple[list[str], str]:
    schema_path = pack_dir / "connector" / "feeds" / f"{feed}.schema.json"
    if not schema_path.is_file():
        return [], f"Pack_{feed}"
    data = json.loads(schema_path.read_text(encoding="utf-8"))
    cols = [str(c.get("name") or "").strip() for c in (data.get("columns") or []) if c.get("name")]
    sheet = str(data.get("sheetName") or f"Pack_{feed}")
    return cols, sheet


def _map_raw_row(raw: dict[str, str]) -> dict[str, Any]:
    mapped: dict[str, Any] = {}
    for raw_key, raw_val in raw.items():
        canon = ALIAS_LOOKUP.get(_normalize_header(raw_key))
        if not canon:
            continue
        mapped[canon] = raw_val
    if "platform_sku" in mapped:
        mapped["platform_sku"] = _normalize_sku(mapped["platform_sku"])
    if "order_date" in mapped:
        mapped["order_date"] = _normalize_date(mapped["order_date"])
    if "ad_date" in mapped:
        mapped["ad_date"] = _normalize_date(mapped["ad_date"])
    if "quantity" in mapped:
        mapped["quantity"] = _coerce_number(mapped["quantity"])
    if "item_price" in mapped:
        mapped["item_price"] = _coerce_number(mapped["item_price"])
    if "spend" in mapped:
        mapped["spend"] = _coerce_number(mapped["spend"])
    if "is_refund" in mapped:
        mapped["is_refund"] = _coerce_bool(mapped["is_refund"])
    biz = mapped.get("order_date") or mapped.get("ad_date") or ""
    if biz:
        mapped["biz_date"] = _normalize_date(biz)
    return mapped


def _output_headers(schema_cols: list[str]) -> list[str]:
    headers = list(schema_cols)
    if "biz_date" not in headers:
        headers.append("biz_date")
    return headers


def _row_to_list(row: dict[str, Any], headers: list[str]) -> list[Any]:
    out: list[Any] = []
    for h in headers:
        val = row.get(h, "")
        if val is None:
            val = ""
        out.append(val)
    return out


def _decode_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "gbk", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("无法识别编码")


def _parse_feed_csv(
    text: str,
    feed_id: str,
    pack_dir: Path,
    source_hash: str,
    source_file: str,
) -> dict[str, Any]:
    schema_cols, sheet_name = _load_schema(pack_dir, feed_id)
    headers = _output_headers(schema_cols)

    reader = csv.DictReader(text.splitlines())
    if not reader.fieldnames:
        raise ValueError("CSV 缺少表头")

    rows: list[list[Any]] = []
    for raw in reader:
        if not any(str(v or "").strip() for v in raw.values()):
            continue
        mapped = _map_raw_row(raw)
        rows.append(_row_to_list(mapped, headers))

    return {
        "feed": feed_id,
        "packId": pack_dir.name,
        "sheetName": sheet_name,
        "headers": headers,
        "rows": rows,
        "meta": {
            "source": "csv_upload" if source_file == "upload" else "csv_local",
            "sourceFile": source_file,
            "sourceHash": source_hash,
            "rowCount": len(rows),
            "attributionNote": "广告点击日 vs 订单成交日存在 0–7 天偏移；精确键匹配，毛利为近似口径",
        },
    }


def load_feed(
    pack_id: str,
    feed: str,
    content: str | None = None,
    content_base64: str | None = None,
) -> dict[str, Any]:
    feed_id = str(feed or "").strip()
    if feed_id not in FEED_FILES:
        raise ValueError(f"未知 feed: {feed_id!r}")

    pack_dir = _config_dir() / "packs" / pack_id

    if content_base64:
        raw_bytes = base64.b64decode(str(content_base64))
        text = _decode_bytes(raw_bytes)
        source_hash = hashlib.sha256(raw_bytes).hexdigest()[:16]
        return _parse_feed_csv(text, feed_id, pack_dir, source_hash, "upload")

    if content is not None and str(content).strip():
        text = str(content)
        raw_bytes = text.encode("utf-8")
        source_hash = hashlib.sha256(raw_bytes).hexdigest()[:16]
        return _parse_feed_csv(text, feed_id, pack_dir, source_hash, "upload")

    fixture = pack_dir / "connector" / "fixtures" / FEED_FILES[feed_id]
    if not fixture.is_file():
        raise FileNotFoundError(f"fixture 不存在: {fixture}")

    raw_bytes = fixture.read_bytes()
    source_hash = hashlib.sha256(raw_bytes).hexdigest()[:16]
    text = _decode_bytes(raw_bytes)
    return _parse_feed_csv(text, feed_id, pack_dir, source_hash, FEED_FILES[feed_id])


def main() -> None:
    try:
        params = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        params = {}
    feed = str(params.get("feed") or "").strip()
    pack_id = str(params.get("packId") or "cross-border-ecommerce-finance").strip()
    content = params.get("content")
    content_base64 = params.get("contentBase64")
    try:
        out = load_feed(
            pack_id,
            feed,
            content=str(content) if content is not None else None,
            content_base64=str(content_base64) if content_base64 else None,
        )
    except (FileNotFoundError, ValueError) as exc:
        sys.stderr.write(str(exc))
        sys.exit(1)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
