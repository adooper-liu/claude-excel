"""web_search is DeepSeek server-side; web_fetch runs on this backend (Office JS has no net)."""

from __future__ import annotations

import re
from html.parser import HTMLParser
from urllib.parse import urlparse
from typing import Any

import httpx

WEB_SEARCH_TOOL = {
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 3,
}
WEB_FETCH_MAX_CHARS = 4000
_URL_RE = re.compile(r"^https?://[^\s<>\"')\]]+$", re.I)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._skip = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, _attrs: list) -> None:
        if tag in ("script", "style", "noscript", "svg"):
            self._skip += 1

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "svg") and self._skip:
            self._skip -= 1

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        t = " ".join(data.split())
        if t:
            self.parts.append(t)


def extract_html_text(html: str) -> str:
    parser = _TextExtractor()
    parser.feed(html or "")
    return "\n".join(parser.parts)


def should_inject_web_search(base_url: str) -> bool:
    return "deepseek" in str(base_url or "").lower()


def merge_web_search(tools: list | None) -> list:
    out: list[Any] = list(tools or [])
    for t in out:
        if not isinstance(t, dict):
            continue
        name = str(t.get("name") or "")
        typ = str(t.get("type") or "")
        if name == "web_search" or typ.startswith("web_search"):
            return out
    out.append(dict(WEB_SEARCH_TOOL))
    return out


def safe_http_url(url: str) -> str | None:
    raw = str(url or "").strip()
    if not _URL_RE.match(raw):
        return None
    host = (urlparse(raw).hostname or "").lower()
    if not host or host in ("localhost", "127.0.0.1", "::1") or host.endswith(".local"):
        return None
    return raw


async def fetch_url_content(url: str) -> dict:
    checked = safe_http_url(url)
    if not checked:
        return {"error": f"invalid or blocked url: {url!r}"}
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(20.0, connect=10.0)) as client:
            resp = await client.get(
                checked,
                headers={"User-Agent": "Mozilla/5.0 (compatible; ClaudeExcel/1.0)"},
            )
            resp.raise_for_status()
    except Exception as exc:
        return {
            "error": f"fetch failed ({exc}) — 站点可能屏蔽抓取或过慢。改用 web_search 快照，缺字段标「未能获取」，不要编造。"
        }
    text = extract_html_text(resp.text)
    if not text.strip():
        return {
            "error": "could not extract readable content (may need login, JavaScript, or be blocked)"
        }
    truncated = len(text) > WEB_FETCH_MAX_CHARS
    return {
        "url": str(resp.url),
        "content": text[:WEB_FETCH_MAX_CHARS],
        "truncated": truncated,
    }
