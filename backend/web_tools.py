"""web_search is DeepSeek server-side; web_fetch runs on this backend (Office JS has no net)."""

from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse
from typing import Any

import httpx

WEB_SEARCH_TOOL = {
    "type": "web_search_20250305",
    "name": "web_search",
    "max_uses": 3,
}
WEB_FETCH_MAX_CHARS = 4000
_URL_RE = re.compile(r"^https?://[^\s<>\"')\]]+$", re.I)
_BLOCKED_HOST_SUFFIX = (".local", ".localhost", ".internal", ".lan")
_BLOCKED_HOSTS = {
    "localhost",
    "metadata.google.internal",
    "metadata.google.com",
    "instance-data",
}


def _parse_ip(host: str) -> ipaddress._BaseAddress | None:
    h = str(host or "").strip().lower().strip("[]")
    if not h:
        return None
    try:
        return ipaddress.ip_address(h)
    except ValueError:
        pass
    if h.isdigit():
        n = int(h)
        if 0 <= n <= 0xFFFFFFFF:
            return ipaddress.ip_address(n)
    return None


def _ip_blocked(ip: ipaddress._BaseAddress) -> bool:
    return bool(
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _host_blocked(host: str, *, resolve: bool = True) -> bool:
    h = (host or "").lower().strip().strip(".")
    if not h or h in _BLOCKED_HOSTS:
        return True
    if any(h.endswith(suf) for suf in _BLOCKED_HOST_SUFFIX):
        return True
    ip = _parse_ip(h)
    if ip is not None:
        return _ip_blocked(ip)
    if not resolve:
        return False
    try:
        infos = socket.getaddrinfo(h, None)
    except OSError:
        return True
    if not infos:
        return True
    for info in infos:
        addr = info[4][0] if info[4] else ""
        parsed = _parse_ip(str(addr).split("%")[0])
        if parsed is None or _ip_blocked(parsed):
            return True
    return False


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


class _TableExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._table: list[list[str]] | None = None
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._skip = 0

    def handle_starttag(self, tag: str, _attrs: list) -> None:
        if tag in ("script", "style", "noscript"):
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "table":
            self._table = []
        elif tag == "tr" and self._table is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript") and self._skip:
            self._skip -= 1
            return
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "tr" and self._row is not None and self._table is not None:
            if any(self._row):
                self._table.append(self._row)
            self._row = None
        elif tag == "table" and self._table is not None:
            if self._table:
                self.tables.append(self._table)
            self._table = None

    def handle_data(self, data: str) -> None:
        if self._skip or self._cell is None:
            return
        self._cell.append(data)


def extract_html_tables(html: str) -> list[list[list[str]]]:
    parser = _TableExtractor()
    parser.feed(html or "")
    return parser.tables


def sheet_name_from_url(url: str) -> str:
    host = (urlparse(url).hostname or "取数").replace("www.", "")
    host = re.sub(r"[^A-Za-z0-9\u4e00-\u9fff._-]+", "_", host).strip("._") or "取数"
    return ("取数_" + host)[:28]


def _redact(exc: BaseException) -> str:
    text = str(exc)
    return re.sub(r"(://[^:@/]+:)[^@/]+@", r"\1***@", text)


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


def safe_http_url(url: str, *, resolve: bool = True) -> str | None:
    raw = str(url or "").strip()
    if not _URL_RE.match(raw):
        return None
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        return None
    if parsed.username or parsed.password:
        return None
    host = (parsed.hostname or "").lower()
    if _host_blocked(host, resolve=resolve):
        return None
    return raw


def col_to_index(token: str) -> int | None:
    s = str(token or "").strip().upper()
    if not s:
        return None
    if s.isdigit():
        n = int(s)
        return n if n >= 1 else None
    if re.fullmatch(r"[A-Z]+", s):
        n = 0
        for ch in s:
            n = n * 26 + (ord(ch) - 64)
        return n if n >= 1 else None
    return None


def index_to_col(n: int) -> str:
    if n < 1:
        return "A"
    chars: list[str] = []
    while n:
        n, rem = divmod(n - 1, 26)
        chars.append(chr(65 + rem))
    return "".join(reversed(chars))


def slice_grid(
    rows: list,
    row_from: str | int | None = None,
    row_to: str | int | None = None,
    col_from: str | int | None = None,
    col_to: str | int | None = None,
) -> list:
    """1-based inclusive range, like Excel. Empty bound means that edge."""
    if not rows:
        return []
    r1 = col_to_index(str(row_from)) if row_from not in (None, "") else 1
    r2 = col_to_index(str(row_to)) if row_to not in (None, "") else len(rows)
    if r1 is None:
        r1 = 1
    if r2 is None:
        r2 = len(rows)
    r1 = max(1, min(r1, len(rows)))
    r2 = max(1, min(r2, len(rows)))
    if r2 < r1:
        r1, r2 = r2, r1
    sliced = rows[r1 - 1 : r2]
    c1 = col_to_index(str(col_from)) if col_from not in (None, "") else None
    c2 = col_to_index(str(col_to)) if col_to not in (None, "") else None
    if c1 is None and c2 is None:
        return sliced
    width = max((len(r) for r in sliced), default=0)
    if width <= 0:
        return sliced
    a = c1 or 1
    b = c2 or width
    a = max(1, min(a, width))
    b = max(1, min(b, width))
    if b < a:
        a, b = b, a
    return [list(r[a - 1 : b]) + [""] * max(0, b - a + 1 - len(r[a - 1 : b])) for r in sliced]


def summarize_grids(grids: list) -> list[dict]:
    out: list[dict] = []
    for i, g in enumerate(grids or []):
        if not g:
            continue
        cols = max((len(r) for r in g), default=0)
        preview = [str(c)[:24] for c in (g[0] if g else []) if str(c).strip()][:8]
        out.append({"index": i, "rows": len(g), "cols": cols, "preview": preview, "colLast": index_to_col(cols)})
    return out


def _cell_rect(c: dict) -> tuple[float, float, float, float]:
    x = float(c.get("x") or 0)
    y = float(c.get("y") or 0)
    w = max(float(c.get("w") or 0), 1)
    h = max(float(c.get("h") or 0), 1)
    return x, y, w, h


def _drop_containing_cells(cells: list[dict]) -> list[dict]:
    kept: list[dict] = []
    for a in cells:
        ax, ay, aw, ah = _cell_rect(a)
        contained = False
        for b in cells:
            if a is b:
                continue
            bx, by, bw, bh = _cell_rect(b)
            if bw * bh >= aw * ah:
                continue
            if ax <= bx and ay <= by and ax + aw >= bx + bw and ay + ah >= by + bh:
                contained = True
                break
        if not contained:
            kept.append(a)
    return kept


def cells_to_grid(cells: list | None) -> list[list[str]]:
    """Turn absolutely positioned cells into a row/column grid."""
    raw = []
    for c in cells or []:
        if not isinstance(c, dict):
            continue
        t = " ".join(str(c.get("t") or "").split())
        if not t:
            continue
        raw.append(c)
    raw = _drop_containing_cells(raw)
    if not raw:
        return []
    hs = sorted(max(float(c.get("h") or 0), 1) for c in raw)
    med_h = hs[len(hs) // 2]
    row_tol = max(8.0, med_h * 0.55)
    ordered = sorted(raw, key=lambda c: (float(c.get("y") or 0), float(c.get("x") or 0)))
    row_groups: list[dict] = []
    for c in ordered:
        cy = float(c.get("y") or 0) + max(float(c.get("h") or 0), 1) / 2
        if row_groups and abs(cy - row_groups[-1]["y"]) <= row_tol:
            row_groups[-1]["cells"].append(c)
            n = len(row_groups[-1]["cells"])
            row_groups[-1]["y"] = (row_groups[-1]["y"] * (n - 1) + cy) / n
        else:
            row_groups.append({"y": cy, "cells": [c]})
    xs = sorted(float(c.get("x") or 0) for c in raw)
    ws = sorted(max(float(c.get("w") or 0), 1) for c in raw)
    col_tol = max(12.0, ws[len(ws) // 2] * 0.35)
    clusters: list[list[float]] = []
    for x in xs:
        if clusters and x - clusters[-1][-1] <= col_tol:
            clusters[-1].append(x)
        else:
            clusters.append([x])
    col_x = [sum(g) / len(g) for g in clusters]
    grid: list[list[str]] = []
    for rg in row_groups:
        row = [""] * len(col_x)
        for c in sorted(rg["cells"], key=lambda z: float(z.get("x") or 0)):
            cx = float(c.get("x") or 0)
            idx = min(range(len(col_x)), key=lambda j: abs(cx - col_x[j]))
            t = " ".join(str(c.get("t") or "").split())
            if not row[idx] or len(t) > len(row[idx]):
                row[idx] = t
        if any(row):
            grid.append(row)
    return grid


def merge_grids(grids: list) -> list[list[str]]:
    """Stack picked regions. Same-width blocks share the first header."""
    cleaned: list[list[list[str]]] = []
    for g in grids or []:
        rows: list[list[str]] = []
        for r in g or []:
            if not isinstance(r, list):
                continue
            rows.append(["" if c is None else str(c) for c in r])
        if any(any(c.strip() for c in r) for r in rows):
            cleaned.append(rows)
    if not cleaned:
        return []
    if len(cleaned) == 1:
        return cleaned[0]
    width = max((len(r) for r in cleaned[0]), default=0)
    same = width > 0 and all(max((len(r) for r in g), default=0) == width for g in cleaned)
    if same:
        head0 = [str(c).strip() for c in cleaned[0][0]]
        out = [list(cleaned[0][0])]
        for g in cleaned:
            head = [str(c).strip() for c in g[0]]
            start = 1 if head == head0 else 0
            out.extend(g[start:])
        return out
    out: list[list[str]] = []
    for i, g in enumerate(cleaned):
        if i:
            out.append([])
        out.extend(g)
    return out


def pick_largest_grid(grids: list) -> list:
    scored = []
    for g in grids or []:
        if not g:
            continue
        cols = max((len(r) for r in g), default=0)
        if cols <= 0:
            continue
        scored.append((len(g) * cols, g))
    if not scored:
        return []
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


def looks_like_app_shell(html: str, text: str, tables: list) -> bool:
    """SPA/login shell: scripts but no HTML table and almost no readable text."""
    if tables:
        return False
    raw = html or ""
    body = (text or "").strip()
    scripts = raw.lower().count("<script")
    if not body:
        return True
    if scripts >= 2 and len(body) < 400:
        return True
    return False


def empty_fetch_error(*, username: str, password: str, as_rows: bool) -> str:
    if username and not password:
        return "已填用户名但未填密码。勾选登录后会在本机弹出浏览器，密码只在本机使用，不要发到对话。"
    if as_rows:
        return (
            "没有解析到表格。勾选「需要登录」后会在本机打开浏览器（可填网页登录账号，支持 ERP 控制台）。"
            "不要把密码发到对话。"
        )
    return "页面没有可读正文。需要登录或 JavaScript 时，用任务窗格取数栏（本机浏览器），不要把密码发给模型。"


async def fetch_url_content(
    url: str,
    username: str | None = None,
    password: str | None = None,
    as_rows: bool = False,
    browser: bool = False,
) -> dict:
    checked = safe_http_url(url)
    if not checked:
        return {"error": f"invalid or blocked url: {url!r}"}
    user = str(username or "").strip()
    secret = str(password or "")
    want_browser = bool(browser or (user and secret))
    if want_browser:
        from web_browser import open_fetch_session
        return await open_fetch_session(checked, user, secret, headed=True)

    auth = (user, secret) if user and secret else None
    current = checked
    try:
        async with httpx.AsyncClient(follow_redirects=False, timeout=httpx.Timeout(20.0, connect=10.0)) as client:
            resp = None
            for _ in range(5):
                hop = safe_http_url(current)
                if not hop:
                    return {"error": f"invalid or blocked url: {current!r}"}
                resp = await client.get(
                    hop,
                    headers={"User-Agent": "Mozilla/5.0 (compatible; ClaudeExcel/1.0)"},
                    auth=auth,
                )
                if resp.status_code in (301, 302, 303, 307, 308):
                    loc = resp.headers.get("location") or ""
                    if not loc:
                        return {"error": f"invalid or blocked url: {current!r}"}
                    current = urljoin(str(resp.url), loc)
                    continue
                break
            if resp is None:
                return {"error": f"invalid or blocked url: {url!r}"}
            if resp.status_code in (401, 403):
                return {
                    "error": "需要登录或无权访问。请勾选任务窗格「需要登录」，本机会弹出浏览器。"
                    "密码只发给本机，不要发到对话。"
                }
            resp.raise_for_status()
    except Exception as exc:
        return {
            "error": (
                f"fetch failed ({_redact(exc)}) — 站点可能屏蔽抓取、要登录或过慢。"
                "缺字段标「未能获取」，不要编造。"
            )
        }
    html = resp.text
    tables = extract_html_tables(html)
    text = extract_html_text(html)
    spa = looks_like_app_shell(html, text, tables)
    if as_rows:
        rows = tables[0] if tables else []
        if rows:
            return {
                "url": str(resp.url),
                "sheetName": sheet_name_from_url(str(resp.url)),
                "rows": rows[:500],
                "truncated": len(rows) > 500,
            }
        if spa:
            return {
                "error": "这是前端页面。请勾选取数栏「需要登录」，在网页窗口点选同类或框选后写入，不必回到 Excel。"
                "不要把密码发到对话。"
            }
        return {"error": empty_fetch_error(username=user, password=secret, as_rows=True)}
    if not text.strip() or spa:
        return {"error": empty_fetch_error(username=user, password=secret, as_rows=False)}
    truncated = len(text) > WEB_FETCH_MAX_CHARS
    return {
        "url": str(resp.url),
        "content": text[:WEB_FETCH_MAX_CHARS],
        "truncated": truncated,
        "tables": len(tables),
    }
