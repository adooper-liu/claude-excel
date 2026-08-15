"""Follow-the-user fetch recipe. Replay comes later; never stores passwords."""

from __future__ import annotations

import json
from typing import Any

from config_store import CONFIG_DIR

RECIPE_FILE = CONFIG_DIR / "fetch-recipe-last.json"
ITERATE_TYPES = ("manual", "pager", "scroll", "detail")
EXTRACT_MODES = ("table", "box", "list", "xhr", "file")


def default_recipe(url: str = "") -> dict[str, Any]:
    return {
        "version": 1,
        "url": str(url or ""),
        "iterate": {"type": "manual", "maxPages": 50, "maxRows": 500},
        "extract": {"mode": "table"},
    }


def validate_recipe(raw: Any) -> dict[str, Any]:
    data = dict(raw) if isinstance(raw, dict) else {}
    out = default_recipe(str(data.get("url") or ""))
    iterate = data.get("iterate") if isinstance(data.get("iterate"), dict) else {}
    kind = str(iterate.get("type") or "manual")
    if kind not in ITERATE_TYPES:
        kind = "manual"
    out["iterate"] = {
        "type": kind,
        "next": str(iterate.get("next") or ""),
        "itemClick": str(iterate.get("itemClick") or ""),
        "maxPages": _bound_int(iterate.get("maxPages"), 50, 1, 200),
        "maxRows": _bound_int(iterate.get("maxRows"), 500, 1, 5000),
    }
    extract = data.get("extract") if isinstance(data.get("extract"), dict) else {}
    mode = str(extract.get("mode") or "table")
    if mode not in EXTRACT_MODES:
        mode = "table"
    out["extract"] = {
        "mode": mode,
        "gridIndex": _bound_int(extract.get("gridIndex"), 0, 0, 99),
        "rowFrom": str(extract.get("rowFrom") or "1"),
        "rowTo": str(extract.get("rowTo") or ""),
        "colFrom": str(extract.get("colFrom") or "A"),
        "colTo": str(extract.get("colTo") or ""),
        "list": str(extract.get("list") or ""),
        "fields": list(extract.get("fields") or []) if isinstance(extract.get("fields"), list) else [],
    }
    return out


def save_recipe(recipe: dict[str, Any]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    RECIPE_FILE.write_text(json.dumps(validate_recipe(recipe), ensure_ascii=False, indent=2), encoding="utf-8")


def load_recipe() -> dict[str, Any]:
    if not RECIPE_FILE.exists():
        return default_recipe()
    try:
        return validate_recipe(json.loads(RECIPE_FILE.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return default_recipe()


def drop_repeated_header(header: list, rows: list) -> list:
    if not rows or not header:
        return list(rows or [])
    left = [str(c).strip() for c in header]
    right = [str(c).strip() for c in rows[0]]
    if left == right:
        return list(rows[1:])
    return list(rows)


def _bound_int(raw: Any, default: int, lo: int, hi: int) -> int:
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, n))
