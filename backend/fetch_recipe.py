"""Follow-the-user fetch recipe. Replay comes later; never stores passwords."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from config_store import CONFIG_DIR
from recipe_hosts import load_host_templates, load_sheet_templates

RECIPE_FILE = CONFIG_DIR / "fetch-recipe-last.json"
RECIPES_DIR = CONFIG_DIR / "fetch-recipes"
DATA_DIR = CONFIG_DIR / "fetch-data"
SITE_RECIPES_DIR = Path(__file__).resolve().parent / "site_recipes"
ITERATE_TYPES = ("manual", "pager", "scroll", "detail")
EXTRACT_MODES = ("table", "box", "list", "xhr", "file", "picker")
FETCH_COOLDOWN_HOURS = 24

# Site/sheet semantics live in repo/recipe/{hosts,sheets}/*.yml — engine only loads them.
HOST_TEMPLATES: dict[str, dict[str, Any]] = load_host_templates()
DATA_SHEET_TEMPLATES: dict[str, dict[str, Any]] = load_sheet_templates()

_HOST_ALIASES = {
    "s.1688.com": "1688.com",
    "detail.1688.com": "1688.com",
    "www.1688.com": "1688.com",
}


def recipe_host_key(url: str) -> str:
    host = (urlparse(str(url or "")).hostname or "unknown").lower().replace("www.", "")
    host = _HOST_ALIASES.get(host, host)
    host = re.sub(r"[^a-z0-9._-]+", "_", host).strip("._") or "unknown"
    return host[:64]


def data_sheet_template_key(sheet_name: str) -> str | None:
    s = str(sheet_name or "").strip().lower()
    if not s:
        return None
    if re.search(r"sif|关键词竞争|供需", s):
        return "sif.keyword"
    if re.search(r"jiimore|极目|挖品|潜力爆", s):
        return "jiimore.discovery"
    if re.search(r"wallysmarter|沃尔玛详情", s):
        return "walmart.detail"
    if re.search(r"1688选品|店雷达|1688榜|dld|导入.*1688|1688.*导入|1688.*json", s):
        return "1688.product"
    if re.search(r"导入.*ebay|ebay.*导入|ebay.*json", s):
        return "ebay.listing"
    return None


def host_from_sheet_name(sheet_name: str) -> str:
    name = str(sheet_name or "").strip()
    m = re.match(r"取数[_-](.+)", name, re.I)
    if not m:
        return ""
    return recipe_host_key("https://" + m.group(1).split("_")[0])


def recipe_path_for_url(url: str) -> str:
    return str((RECIPES_DIR / (recipe_host_key(url) + ".json")).resolve())


def default_recipe(url: str = "") -> dict[str, Any]:
    base: dict[str, Any] = {
        "version": 1,
        "url": str(url or ""),
        "host": recipe_host_key(url),
        "iterate": {"type": "manual", "maxPages": 50, "maxRows": 500},
        "extract": {"mode": "table", "fields": [], "hasHead": False, "columnLabels": []},
    }
    return merge_host_template(base)


def get_host_template(host: str) -> dict[str, Any] | None:
    key = recipe_host_key("https://" + host if host and "://" not in host else host or "")
    return HOST_TEMPLATES.get(key)


def merge_host_template(recipe: dict[str, Any]) -> dict[str, Any]:
    host = str(recipe.get("host") or recipe_host_key(str(recipe.get("url") or "")))
    tpl = get_host_template(host)
    if not tpl:
        return recipe
    out = dict(recipe)
    if tpl.get("notes") and not out.get("notes"):
        out["notes"] = tpl["notes"]
    iterate = dict(out.get("iterate") or {})
    for k, v in (tpl.get("iterate") or {}).items():
        if k not in iterate or iterate.get(k) in ("", None, 0):
            iterate[k] = v
    out["iterate"] = iterate
    if tpl.get("display") and not out.get("display"):
        out["display"] = dict(tpl["display"])
    proj = out.get("project") if isinstance(out.get("project"), dict) else {}
    tpl_proj = tpl.get("project") if isinstance(tpl.get("project"), dict) else {}
    if tpl_proj and not proj.get("columns"):
        out["project"] = {
            "headerless": bool(tpl_proj.get("headerless", True)),
            "targets": list(tpl_proj.get("targets") or []),
            "columns": list(tpl_proj.get("columns") or []),
        }
    return out


def _normalize_fields(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("as") or "").strip()[:24]
        col = item.get("col")
        col_i = int(col) if isinstance(col, int) or (isinstance(col, str) and str(col).isdigit()) else None
        query = str(item.get("query") or "").strip()[:240]
        field_type = str(item.get("type") or "").strip()[:16]
        attribute = str(item.get("attribute") or "").strip()[:48]
        merge = item.get("mergeCols") if isinstance(item.get("mergeCols"), list) else item.get("merge")
        merge_cols: list[int] = []
        if isinstance(merge, list):
            for m in merge:
                try:
                    merge_cols.append(int(m))
                except (TypeError, ValueError):
                    continue
        entry: dict[str, Any] = {"name": name}
        if col_i is not None and col_i >= 0:
            entry["col"] = col_i
        if merge_cols:
            entry["mergeCols"] = merge_cols
        if query:
            entry["query"] = query
        if field_type and field_type != "text":
            entry["type"] = field_type
        if attribute:
            entry["attribute"] = attribute
        if query and not name:
            continue
        if name or col_i is not None or merge_cols or query:
            out.append(entry)
    return out


def _normalize_project_columns(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        spec: dict[str, Any] = {"as": str(item.get("as") or "").strip()[:24]}
        if not spec["as"]:
            continue
        if isinstance(item.get("merge"), list) and item["merge"]:
            spec["merge"] = [int(x) for x in item["merge"] if str(x).isdigit() or isinstance(x, int)]
        elif item.get("from") is not None and item.get("from") != "":
            spec["from"] = item["from"]
        else:
            continue
        if item.get("separator") is not None:
            spec["separator"] = str(item.get("separator"))
        coerce = item.get("coerce")
        if coerce in ("number", "text", "date"):
            spec["coerce"] = coerce
        out.append(spec)
    return out


def validate_recipe(raw: Any) -> dict[str, Any]:
    data = dict(raw) if isinstance(raw, dict) else {}
    url = str(data.get("url") or "")
    out = default_recipe(url)
    out["host"] = recipe_host_key(url)
    if data.get("notes"):
        out["notes"] = str(data.get("notes"))[:500]
    iterate = data.get("iterate") if isinstance(data.get("iterate"), dict) else {}
    kind = str(iterate.get("type") or out["iterate"]["type"] or "manual")
    if kind not in ITERATE_TYPES:
        kind = "manual"
    out["iterate"] = {
        **out.get("iterate", {}),
        "type": kind,
        "next": str(iterate.get("next") or ""),
        "itemClick": str(iterate.get("itemClick") or ""),
        "maxPages": _bound_int(iterate.get("maxPages"), 50, 1, 200),
        "maxRows": _bound_int(iterate.get("maxRows"), 500, 1, 5000),
        "sort": str(iterate.get("sort") or out["iterate"].get("sort") or ""),
        "page": _bound_int(iterate.get("page"), int(out["iterate"].get("page") or 1), 1, 100),
        "device": str(iterate.get("device") or out["iterate"].get("device") or "desktop")[:32],
        "deliveryZip": str(iterate.get("deliveryZip") or out["iterate"].get("deliveryZip") or "")[:32],
        "site": str(iterate.get("site") or out["iterate"].get("site") or out["host"])[:64],
    }
    extract = data.get("extract") if isinstance(data.get("extract"), dict) else {}
    mode = str(extract.get("mode") or "table")
    if mode not in EXTRACT_MODES:
        mode = "table"
    fields = _normalize_fields(extract.get("fields"))
    labels = extract.get("columnLabels")
    column_labels: list[str] = []
    if isinstance(labels, list):
        column_labels = [str(x).strip()[:24] for x in labels if str(x).strip()]
    elif fields:
        column_labels = [str(f.get("name") or "").strip() for f in fields if str(f.get("name") or "").strip()]
    out["extract"] = {
        **out.get("extract", {}),
        "mode": mode,
        "gridIndex": _bound_int(extract.get("gridIndex"), 0, 0, 99),
        "rowFrom": str(extract.get("rowFrom") or "1"),
        "rowTo": str(extract.get("rowTo") or ""),
        "colFrom": str(extract.get("colFrom") or "A"),
        "colTo": str(extract.get("colTo") or ""),
        "list": str(extract.get("list") or extract.get("listQuery") or ""),
        "fields": fields,
        "hasHead": bool(extract.get("hasHead")),
        "columnLabels": column_labels[:40],
    }
    proj = data.get("project") if isinstance(data.get("project"), dict) else {}
    if proj or out.get("project"):
        base_proj = out.get("project") if isinstance(out.get("project"), dict) else {}
        cols = _normalize_project_columns(proj.get("columns") if proj.get("columns") else base_proj.get("columns"))
        out["project"] = {
            "headerless": bool(proj.get("headerless", base_proj.get("headerless", True))),
            "targets": list(proj.get("targets") or base_proj.get("targets") or []),
            "columns": cols,
        }
    if isinstance(data.get("display"), dict):
        out["display"] = {
            "reviewTextMode": str(data["display"].get("reviewTextMode") or "keep"),
            "markSponsored": bool(data["display"].get("markSponsored")),
        }
    for key in ("lastFetchAt", "lastFetchRows", "updatedAt"):
        if data.get(key) is not None:
            out[key] = data[key]
    return out


def recipe_project_columns(recipe: dict[str, Any], target_names: list[str] | None = None) -> dict[str, Any] | None:
    proj = recipe.get("project") if isinstance(recipe.get("project"), dict) else None
    if not proj or not proj.get("columns"):
        return None
    cols = _normalize_project_columns(proj.get("columns"))
    if not cols:
        return None
    want = target_names or list(proj.get("targets") or [])
    if want:
        order = [n for n in want if any(c.get("as") == n for c in cols)]
        ordered = [c for n in order for c in cols if c.get("as") == n]
        if len(ordered) >= min(3, len(want)):
            cols = ordered
    display = recipe.get("display") if isinstance(recipe.get("display"), dict) else {}
    review_keep = display.get("reviewTextMode") == "keep"
    for c in cols:
        if c.get("as") == "评论数" and review_keep and "coerce" in c:
            del c["coerce"]
    return {"columns": cols, "headerless": bool(proj.get("headerless", True))}


def resolve_project_for_url(url: str, target_names: list[str] | None = None) -> dict[str, Any] | None:
    recipe = load_recipe(url)
    hit = recipe_project_columns(recipe, target_names)
    if hit:
        return hit
    tpl = get_host_template(recipe.get("host") or recipe_host_key(url))
    if not tpl:
        return None
    merged = merge_host_template({**default_recipe(url), **recipe, "project": tpl.get("project")})
    return recipe_project_columns(merged, target_names)


def project_targets_for_sheet(sheet_name: str, url: str = "") -> list[str]:
    key = data_sheet_template_key(sheet_name)
    if key and key in DATA_SHEET_TEMPLATES:
        return list(DATA_SHEET_TEMPLATES[key].get("targets") or [])
    host = host_from_sheet_name(sheet_name) or (recipe_host_key(url) if url else "")
    tpl = get_host_template(host) if host else None
    if tpl and isinstance(tpl.get("project"), dict):
        return list(tpl["project"].get("targets") or [])
    return []


def resolve_project_for_sheet(
    sheet_name: str,
    url: str = "",
    target_names: list[str] | None = None,
) -> dict[str, Any] | None:
    key = data_sheet_template_key(sheet_name)
    if key and key in DATA_SHEET_TEMPLATES:
        hit = recipe_project_columns({"project": DATA_SHEET_TEMPLATES[key], "display": {}}, target_names)
        if hit:
            return hit
    page_url = str(url or "").strip()
    if not page_url:
        host = host_from_sheet_name(sheet_name)
        if host:
            page_url = "https://www." + host + "/"
    if page_url:
        return resolve_project_for_url(page_url, target_names)
    return None


def fetch_repeat_warning(url: str) -> str:
    recipe = load_recipe(url)
    last = recipe.get("lastFetchAt")
    if not last:
        return ""
    try:
        ts = datetime.fromisoformat(str(last).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_h = (datetime.now(timezone.utc) - ts).total_seconds() / 3600.0
    except ValueError:
        return ""
    if age_h < FETCH_COOLDOWN_HOURS:
        rows = recipe.get("lastFetchRows")
        extra = f"（上次 {rows} 行）" if rows else ""
        return (
            f"⚠ 该站点 {int(age_h)} 小时前刚取过数{extra}。"
            "换关键词/翻页/改邮编会生成新数据；重复写入前请确认。"
        )
    return ""


def archive_ingest_rows(url: str, rows: list, job_id: str) -> str:
    host = recipe_host_key(url)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    host_dir = DATA_DIR / host
    host_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = host_dir / f"{stamp}-{job_id[:8]}.json"
    payload = {
        "url": url,
        "host": host,
        "rows": rows,
        "rowCount": len(rows),
        "colCount": max((len(r) for r in rows), default=0),
        "savedAt": datetime.now(timezone.utc).isoformat(),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return str(path.resolve())


def save_recipe(recipe: dict[str, Any]) -> dict[str, Any]:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    RECIPES_DIR.mkdir(parents=True, exist_ok=True)
    clean = validate_recipe(merge_host_template(recipe))
    clean["updatedAt"] = datetime.now(timezone.utc).isoformat()
    RECIPE_FILE.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    host_file = RECIPES_DIR / (clean["host"] + ".json")
    host_file.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    return clean


def _host_matches_template(host: str, data: dict[str, Any]) -> bool:
    if str(data.get("host") or "").strip().lower() == host:
        return True
    match = data.get("match") if isinstance(data.get("match"), dict) else {}
    suffixes = match.get("hostSuffix") if isinstance(match.get("hostSuffix"), list) else []
    for raw in suffixes:
        suffix = str(raw or "").strip().lower()
        if not suffix:
            continue
        if not suffix.startswith("."):
            suffix = "." + suffix
        bare = suffix.lstrip(".")
        if host == bare or host.endswith(suffix):
            return True
    return False


def load_site_template(host: str) -> dict[str, Any] | None:
    key = recipe_host_key("https://" + host if host and "://" not in host else host or "")
    if not SITE_RECIPES_DIR.is_dir():
        return None
    direct = SITE_RECIPES_DIR / (key + ".json")
    if direct.is_file():
        try:
            data = json.loads(direct.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else None
        except (OSError, json.JSONDecodeError):
            return None
    for path in sorted(SITE_RECIPES_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if isinstance(data, dict) and _host_matches_template(key, data):
            return data
    return None


def resolve_recipe(url: str = "") -> tuple[dict[str, Any], str]:
    url = str(url or "")
    host = recipe_host_key(url)
    host_file = RECIPES_DIR / (host + ".json")
    if host_file.is_file():
        try:
            saved = validate_recipe(json.loads(host_file.read_text(encoding="utf-8")))
            fields = (saved.get("extract") or {}).get("fields") or []
            if fields:
                if url:
                    saved["url"] = url
                return saved, "saved"
        except (OSError, json.JSONDecodeError):
            pass
    tmpl = load_site_template(host)
    if tmpl:
        merged = validate_recipe({**dict(tmpl), "url": url, "host": host})
        return merged, "template"
    return default_recipe(url), "default"


def load_recipe(url: str = "") -> dict[str, Any]:
    recipe, _source = resolve_recipe(url)
    return recipe


def list_recipes() -> list[dict[str, Any]]:
    if not RECIPES_DIR.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for path in sorted(RECIPES_DIR.glob("*.json")):
        try:
            data = validate_recipe(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
        proj = data.get("project") if isinstance(data.get("project"), dict) else {}
        out.append(
            {
                "host": data.get("host") or path.stem,
                "url": data.get("url") or "",
                "path": str(path.resolve()),
                "mode": (data.get("extract") or {}).get("mode"),
                "fields": len((data.get("extract") or {}).get("fields") or []),
                "projectColumns": len(proj.get("columns") or []),
                "hasTemplate": bool(get_host_template(str(data.get("host") or path.stem))),
            }
        )
    return out


_EXTRACT_MODE_LABELS: dict[str, str] = {
    "picker": "跟手点选同类，锁定列",
    "box": "框选表格区域",
    "table": "自动识别页面表格",
    "xhr": "等接口表出现",
    "list": "列表模式",
    "file": "文件导入",
}


def render_fetch_steps(recipe: dict[str, Any]) -> str:
    """Human-readable fetch path (🟢🟡🔴), no table body or credentials."""
    data = validate_recipe(recipe) if isinstance(recipe, dict) else default_recipe("")
    url = str(data.get("url") or "").strip()
    host = str(data.get("host") or recipe_host_key(url))
    extract = data.get("extract") if isinstance(data.get("extract"), dict) else {}
    mode = str(extract.get("mode") or "table")
    fields = extract.get("fields") if isinstance(extract.get("fields"), list) else []
    iterate = data.get("iterate") if isinstance(data.get("iterate"), dict) else {}
    proj = data.get("project") if isinstance(data.get("project"), dict) else {}
    lines: list[str] = []

    if url:
        lines.append("🟢 打开 " + url[:240])
    else:
        lines.append("🟢 打开 " + host + " 列表页")

    label = _EXTRACT_MODE_LABELS.get(mode, mode)
    lines.append("🟢 采集方式：" + label)

    if fields:
        names = [
            str(f.get("name") or "").strip()
            for f in fields
            if isinstance(f, dict) and str(f.get("name") or "").strip()
        ]
        if names:
            shown = "、".join(names[:8])
            if len(names) > 8:
                shown += "…"
            lines.append("🟡 锁定 " + str(len(names)) + " 列：" + shown)
        else:
            lines.append("🟡 锁定 " + str(len(fields)) + " 列（按列位置映射）")

    cols = proj.get("columns") if isinstance(proj.get("columns"), list) else []
    targets = proj.get("targets") if isinstance(proj.get("targets"), list) else []
    if cols:
        as_names = [str(c.get("as") or "") for c in cols if isinstance(c, dict) and c.get("as")]
        if as_names:
            shown = "、".join(as_names[:6])
            if len(as_names) > 6:
                shown += "…"
            lines.append("🟢 规整目标列：" + shown)
    elif targets:
        shown = "、".join(str(t) for t in targets[:6])
        if len(targets) > 6:
            shown += "…"
        lines.append("🟡 规范列待映射：" + shown)

    iter_type = str(iterate.get("type") or "manual")
    if iter_type == "manual":
        lines.append("🟡 翻页后追加：人工翻页，在网页点「追加」")
    else:
        lines.append("🟡 翻页方式：" + iter_type + "（当前仅记录，不自动回放）")

    lines.append("🔴 登录 / 验证码 / 人机验证：人工在浏览器完成")

    last = data.get("lastFetchAt")
    rows = data.get("lastFetchRows")
    if last:
        extra = "（上次 " + str(rows) + " 行）" if rows else ""
        lines.append("ℹ️ 最近采集：" + str(last) + extra)

    lines.append("")
    lines.append(
        "边界：跟手采集的列位为页面估算，非平台官方指标；缺失字段标待补全。"
    )
    return "\n".join(lines)


def export_recipe(url: str) -> dict[str, Any]:
    recipe, source = resolve_recipe(url)
    path = recipe_path_for_url(recipe.get("url") or url)
    project = recipe_project_columns(recipe)
    steps = render_fetch_steps(recipe)
    return {
        "recipe": recipe,
        "path": path,
        "project": project,
        "stepsMarkdown": steps,
        "source": source,
    }


def import_recipe(raw: Any) -> dict[str, Any]:
    saved = save_recipe(raw if isinstance(raw, dict) else {})
    return {"ok": True, "recipe": saved, "path": recipe_path_for_url(saved.get("url") or "")}


def touch_recipe_fetch(url: str, row_count: int = 0) -> dict[str, Any]:
    base = load_recipe(url)
    base["url"] = str(url or base.get("url") or "")
    base["host"] = recipe_host_key(base["url"])
    base["lastFetchAt"] = datetime.now(timezone.utc).isoformat()
    if row_count > 0:
        base["lastFetchRows"] = row_count
    return save_recipe(base)


def update_recipe_from_picker(
    url: str,
    *,
    fields: list | None = None,
    has_head: bool = False,
    mode: str = "picker",
    column_labels: list | None = None,
    row_count: int = 0,
) -> dict[str, Any]:
    base = load_recipe(url)
    base["url"] = str(url or base.get("url") or "")
    base["host"] = recipe_host_key(base["url"])
    if fields is not None:
        norm_fields = _normalize_fields(fields)
        labels = column_labels if isinstance(column_labels, list) else [f.get("name") for f in norm_fields]
        base["extract"] = {
            **base.get("extract", {}),
            "mode": mode if mode in EXTRACT_MODES else "picker",
            "fields": norm_fields,
            "hasHead": bool(has_head or norm_fields),
            "columnLabels": [str(x).strip()[:24] for x in (labels or []) if str(x).strip()][:40],
        }
        base["iterate"] = {**base.get("iterate", {}), "type": "manual"}
    base["lastFetchAt"] = datetime.now(timezone.utc).isoformat()
    if row_count > 0:
        base["lastFetchRows"] = row_count
    return save_recipe(base)


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
