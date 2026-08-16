"""Queue tables sent by the Chrome extension. Loopback only; never stores passwords."""

from __future__ import annotations

import secrets
from typing import Any

from fetch_recipe import (
    archive_ingest_rows,
    export_recipe,
    fetch_repeat_warning,
    project_targets_for_sheet,
    recipe_path_for_url,
    resolve_project_for_sheet,
    touch_recipe_fetch,
    update_recipe_from_picker,
)
from web_tools import sheet_name_from_url

MAX_JOBS = 8
MAX_ROWS = 500

_jobs: list[dict[str, Any]] = []
_last_sheet = ""


def _ingest_summary(rows: list, url: str) -> dict[str, Any]:
    width = max((len(r) for r in rows), default=0)
    sample = rows[0][:8] if rows else []
    return {
        "rowCount": len(rows),
        "colCount": width,
        "sampleHead": [str(c)[:24] for c in sample],
        "url": url,
    }


def push_ingest(req: dict | None) -> dict[str, Any]:
    data = req if isinstance(req, dict) else {}
    rows = data.get("rows")
    if not isinstance(rows, list) or not rows:
        return {"error": "没有表格。请在有数据的页面再试，或改用站点导出 Excel。"}
    clean: list[list[str]] = []
    for row in rows[:MAX_ROWS]:
        if not isinstance(row, list):
            continue
        clean.append([str(c) if c is not None else "" for c in row])
    if not clean:
        return {"error": "没有表格。请在有数据的页面再试。"}
    if not any(any(str(c).strip() for c in r) for r in clean):
        return {"error": "表格是空的。请选列表数据再写入，不要写配置接口。"}
    append = bool(data.get("append"))
    url = str(data.get("url") or "")
    name = str(data.get("sheetName") or "").strip()
    fields = data.get("fields")
    has_head = bool(data.get("hasHead"))
    column_labels = data.get("columnLabels")
    extract_mode = str(data.get("extractMode") or "picker")
    fetch_warning = fetch_repeat_warning(url) if url else ""
    global _last_sheet
    if append and _last_sheet:
        name = _last_sheet
    elif not name:
        name = sheet_name_from_url(url) if url else "取数_网页"
    recipe_path = ""
    steps_markdown = ""
    project_hint: dict[str, Any] | None = None
    template_targets: list[str] = []
    data_path = ""
    job_id = secrets.token_urlsafe(8)
    try:
        if url:
            data_path = archive_ingest_rows(url, clean, job_id)
    except OSError:
        data_path = ""
    template_targets = project_targets_for_sheet(name, url)
    if url:
        try:
            if isinstance(fields, list) and fields:
                saved = update_recipe_from_picker(
                    url,
                    fields=fields,
                    has_head=has_head,
                    mode=extract_mode,
                    column_labels=column_labels if isinstance(column_labels, list) else None,
                    row_count=len(clean),
                )
            else:
                saved = touch_recipe_fetch(url, len(clean))
            recipe_path = recipe_path_for_url(saved.get("url") or url)
            project_hint = resolve_project_for_sheet(name, url)
            try:
                steps_markdown = str(export_recipe(url).get("stepsMarkdown") or "")
            except OSError:
                steps_markdown = ""
        except OSError:
            recipe_path = ""
            steps_markdown = ""
    summary = _ingest_summary(clean, url)
    can_reshape = bool(project_hint and project_hint.get("columns")) or bool(template_targets)
    reshape_hint = ""
    if can_reshape:
        cols = " / ".join(template_targets[:6]) if template_targets else "排名/标题/…"
        reshape_hint = "写入后可发：①整理成规整列（" + cols + "）"
    job = {
        "id": job_id,
        "rows": clean,
        "sheetName": name,
        "append": bool(append and _last_sheet),
        "url": url,
        "truncated": len(rows) > MAX_ROWS,
        "sourceRows": len(rows),
        "recipePath": recipe_path,
        "stepsMarkdown": steps_markdown,
        "dataPath": data_path,
        "summary": summary,
        "fetchWarning": fetch_warning,
        "projectReady": can_reshape,
        "reshapeHint": reshape_hint,
    }
    _jobs.append(job)
    del _jobs[:-MAX_JOBS]
    if not job["append"]:
        _last_sheet = name
    return {
        "ok": True,
        "id": job["id"],
        "sheetName": job["sheetName"],
        "append": job["append"],
        "rows": len(clean),
        "sourceRows": len(rows),
        "truncated": bool(job["truncated"]),
        "recipePath": job.get("recipePath") or "",
        "stepsMarkdown": job.get("stepsMarkdown") or "",
        "dataPath": data_path,
        "fetchWarning": fetch_warning,
        "projectReady": job["projectReady"],
        "reshapeHint": job["reshapeHint"],
        "summary": summary,
    }


def pending_ingest() -> dict[str, Any]:
    if not _jobs:
        return {"job": None}
    return {"job": dict(_jobs[0])}


def ack_ingest(job_id: str) -> dict[str, Any]:
    global _jobs
    jid = str(job_id or "")
    _jobs = [j for j in _jobs if j.get("id") != jid]
    return {"ok": True, "left": len(_jobs)}


def reset_ingest() -> None:
    global _jobs, _last_sheet
    _jobs = []
    _last_sheet = ""
