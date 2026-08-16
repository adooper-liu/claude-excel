"""Minimal HTTP helper for user.* handler subprocesses."""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path


def get(url: str, timeout: float = 10.0) -> dict:
    backend = Path(__file__).resolve().parents[1]
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    from web_tools import safe_http_url

    safe = safe_http_url(str(url or "").strip())
    if not safe:
        raise PermissionError("NETWORK_DENIED")
    req = urllib.request.Request(safe, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(65536).decode("utf-8", errors="replace")
            ctype = resp.headers.get("Content-Type", "")
    except urllib.error.URLError as exc:
        raise RuntimeError(str(exc)) from exc
    return {"url": safe, "contentType": ctype, "body": body}


def post(url: str, data: dict | None = None, timeout: float = 10.0) -> dict:
    backend = Path(__file__).resolve().parents[1]
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    from web_tools import safe_http_url

    safe = safe_http_url(str(url or "").strip())
    if not safe:
        raise PermissionError("NETWORK_DENIED")
    payload = json.dumps(data or {}).encode("utf-8")
    req = urllib.request.Request(
        safe,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read(65536).decode("utf-8", errors="replace")
            ctype = resp.headers.get("Content-Type", "")
    except urllib.error.URLError as exc:
        raise RuntimeError(str(exc)) from exc
    return {"url": safe, "contentType": ctype, "body": body}
