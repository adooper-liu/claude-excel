"""Queue tables sent by the Chrome extension. Loopback only; never stores passwords."""

from __future__ import annotations

import secrets
from typing import Any

from web_tools import sheet_name_from_url

MAX_JOBS = 8
MAX_ROWS = 500

_jobs: list[dict[str, Any]] = []
_last_sheet = ""


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
    global _last_sheet
    if append and _last_sheet:
        name = _last_sheet
    elif not name:
        name = sheet_name_from_url(url) if url else "取数_网页"
    job = {
        "id": secrets.token_urlsafe(8),
        "rows": clean,
        "sheetName": name,
        "append": bool(append and _last_sheet),
        "url": url,
        "truncated": len(rows) > MAX_ROWS,
    }
    _jobs.append(job)
    del _jobs[:-MAX_JOBS]
    if not job["append"]:
        _last_sheet = name
    return {"ok": True, "id": job["id"], "sheetName": job["sheetName"], "append": job["append"], "rows": len(clean)}


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
