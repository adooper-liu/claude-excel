"""User-authored extraction templates for documents.

A recipe describes where columns live and how values should be cleaned.  It
contains user data only: this module never owns invoice-specific fields.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config_store import CONFIG_DIR

DOC_RECIPES_DIR = CONFIG_DIR / "doc-recipes"
FIELD_TYPES = ("text", "number", "date", "amount", "percent")
SAMPLE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp", ".pdf")


def _template_key(name: str) -> str:
    """Turn a user template name into a safe basename while keeping Unicode."""
    clean = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", str(name or "").strip())
    clean = clean.strip(" ._")
    return (clean or "template")[:80]


def _string_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    return [str(item) for item in raw if str(item).strip()]


def _normalize_format(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    number_style = str(data.get("numberStyle") or "").strip().lower()
    if number_style in ("us", "eu"):
        out["numberStyle"] = number_style
    symbols = _string_list(data.get("stripSymbols"))
    if symbols:
        out["stripSymbols"] = symbols
    nulls = _string_list(data.get("nullValues"))
    if nulls:
        out["nullValues"] = nulls
    date_format = str(data.get("dateFormat") or "").strip()
    if date_format:
        out["dateFormat"] = date_format[:32]
    return out


def _normalize_fields(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValueError("fields 必须是字段数组")
    fields: list[dict[str, Any]] = []
    for raw_field in raw:
        if not isinstance(raw_field, dict):
            raise ValueError("fields 每项必须是对象")
        name = str(raw_field.get("name") or "").strip()
        if not name:
            raise ValueError("fields 每项必须有 name")
        field_type = str(raw_field.get("type") or "").strip().lower()
        if field_type not in FIELD_TYPES:
            raise ValueError(
                "fields type 仅支持 " + "、".join(FIELD_TYPES) + "，收到：" + field_type
            )
        field: dict[str, Any] = {"name": name[:80], "type": field_type}
        # group is a locator kind: "header" fields are found by key name,
        # "detail" fields by table header column. Absent/invalid group is
        # omitted (not defaulted to "detail") so old templates without group
        # keep the legacy single-sheet positional path (backward compatible).
        group = str(raw_field.get("group") or "").strip().lower()
        if group in ("header", "detail"):
            field["group"] = group
        # source is a locator: for group=header it is the key name (e.g.
        # 发票号码), for group=detail the table header column name (e.g. 金额).
        # Empty source falls back to positional alignment in apply_recipe.
        source = str(raw_field.get("source") or "").strip()
        if source:
            field["source"] = source[:100]
        # position is an optional normalized spatial anchor: [x1, y1, x2, y2]
        # in 0..1 (relative to the document; detail may be relative to the
        # table x-extent).  Invalid values are dropped, never fail the recipe.
        position = _normalize_position(raw_field.get("position"))
        if position:
            field["position"] = position
        fmt = _normalize_format(raw_field.get("format"))
        if fmt:
            field["format"] = fmt
        fields.append(field)
    return fields


def _normalize_position(raw: Any) -> list[float] | None:
    """Validate a position anchor: 4 floats each in [0, 1] (or empty)."""
    if raw is None or raw == "":
        return None
    if not isinstance(raw, (list, tuple)) or len(raw) != 4:
        return None
    try:
        values = [float(v) for v in raw]
    except (TypeError, ValueError):
        return None
    if not all(0.0 <= v <= 1.0 for v in values):
        return None
    return values


def _normalize_sample(raw: Any) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    if value in (".", "..") or "/" in value or "\\" in value or Path(value).name != value:
        raise ValueError("sample 只能是样例文件名，不能包含路径")
    if Path(value).suffix.lower() not in SAMPLE_EXTENSIONS:
        raise ValueError("sample 仅支持图片或 PDF 文件")
    return value


def validate_doc_recipe(raw: Any) -> dict[str, Any]:
    data = raw if isinstance(raw, dict) else {}
    name = str(data.get("name") or "").strip()
    if not name:
        raise ValueError("name 必填")
    return {
        "name": name[:80],
        "description": str(data.get("description") or "").strip()[:500],
        "fields": _normalize_fields(data.get("fields")),
        "sample": _normalize_sample(data.get("sample")),
        "createdAt": str(data.get("createdAt") or "").strip(),
        "updatedAt": str(data.get("updatedAt") or "").strip(),
    }


def _path_for(name: str) -> Path:
    return DOC_RECIPES_DIR / (_template_key(name) + ".json")


def save_doc_recipe(
    raw: dict[str, Any],
    *,
    original_name: str = "",
    sample_data: bytes | None = None,
    sample_filename: str = "",
) -> dict[str, Any]:
    if sample_data is not None and not sample_data:
        raise ValueError("sample 文件为空")
    if sample_data is not None:
        extension = Path(sample_filename or "").suffix.lower()
        if Path(sample_filename or "").name != (sample_filename or "") or not extension:
            raise ValueError("sample 文件名不合法")
        if extension not in SAMPLE_EXTENSIONS:
            raise ValueError("sample 仅支持图片或 PDF 文件")

    incoming = validate_doc_recipe(raw)
    DOC_RECIPES_DIR.mkdir(parents=True, exist_ok=True)
    path = _path_for(incoming["name"])
    if path.exists():
        try:
            existing = validate_doc_recipe(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, ValueError):
            existing = None
        # Only the template being edited may be overwritten in place; renaming
        # onto an unrelated template's name (or re-creating a duplicate) is a
        # conflict, never a silent overwrite.
        if (
            not original_name
            or not existing
            or _template_key(existing["name"]) != _template_key(original_name)
        ):
            raise ValueError("模板名与已有模板冲突")

    now = datetime.now(timezone.utc).isoformat()
    incoming["createdAt"] = incoming["createdAt"] or now
    incoming["updatedAt"] = now

    if sample_data is not None:
        samples_dir = DOC_RECIPES_DIR / "samples"
        samples_dir.mkdir(parents=True, exist_ok=True)
        sample_path = samples_dir / (_template_key(incoming["name"]) + extension)
        sample_path.write_bytes(sample_data)
        incoming["sample"] = sample_path.name

    path.write_text(json.dumps(incoming, ensure_ascii=False, indent=2), encoding="utf-8")
    return incoming


def load_doc_recipe(name: str) -> dict[str, Any]:
    path = _path_for(name)
    if not path.is_file():
        raise FileNotFoundError("模板不存在")
    try:
        return validate_doc_recipe(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError("模板文件损坏") from exc


def list_doc_recipes() -> list[dict[str, Any]]:
    if not DOC_RECIPES_DIR.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(DOC_RECIPES_DIR.glob("*.json")):
        try:
            data = validate_doc_recipe(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        item = {
            "name": data["name"],
            "description": data["description"],
            "fieldCount": len(data["fields"]),
            "updatedAt": data["updatedAt"],
        }
        if data["sample"]:
            item["sample"] = data["sample"]
        out.append(item)
    return out


def delete_doc_recipe(name: str) -> None:
    path = _path_for(name)
    if not path.is_file():
        raise FileNotFoundError("模板不存在")
    try:
        data = validate_doc_recipe(json.loads(path.read_text(encoding="utf-8")))
        sample = data.get("sample") or ""
    except (OSError, json.JSONDecodeError, ValueError):
        sample = ""
    path.unlink()
    if sample:
        sample_path = DOC_RECIPES_DIR / "samples" / sample
        if sample_path.is_file() and sample_path.parent == DOC_RECIPES_DIR / "samples":
            sample_path.unlink()
