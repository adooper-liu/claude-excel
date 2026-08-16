"""Local headed Chrome/Edge for follow-the-user fetch. Passwords never leave this process."""

from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass
from typing import Any

from pathlib import Path

from config_store import CONFIG_DIR
from fetch_recipe import default_recipe, load_recipe, save_recipe, validate_recipe
from web_ingest import push_ingest
from web_tools import (
    cells_to_grid,
    extract_html_tables,
    merge_grids,
    pick_largest_grid,
    sheet_name_from_url,
    slice_grid,
    summarize_grids,
)

PLAYWRIGHT_HINT = (
    "本机还没有浏览器内核。请在仓库目录运行：pip install playwright && playwright install chromium。"
    "密码只在本机填写，不要发到对话。"
)

SESSION_TTL_SEC = 2700
PROFILE_DIR = CONFIG_DIR / "browser-profile"

EXTRACT_AND_MARK_JS = """() => {
  const txt = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
  const grids = [];
  const roots = [];
  const push = (rows, root) => {
    const clean = (rows || []).map((r) => (r || []).map((c) => String(c || "").trim())).filter((r) => r.some(Boolean));
    if (clean.length) {
      grids.push(clean);
      roots.push(root || null);
    }
  };
  document.querySelectorAll("table").forEach((t) => {
    push([...t.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map(txt)), t);
  });
  document.querySelectorAll(".ant-table, .el-table, .vxe-table, .kd-table").forEach((root) => {
    const head = [...root.querySelectorAll("thead th, .ant-table-thead th, .el-table__header th, .vxe-header--column")].map(txt);
    const body = [...root.querySelectorAll("tbody tr, .ant-table-row, .el-table__row, .vxe-body--row")].map((tr) =>
      [...tr.querySelectorAll("td, .vxe-body--column")].map(txt)
    );
    push(head.length ? [head, ...body] : body, root);
  });
  const ariaRoot = document.querySelector('[role="grid"], [role="table"]');
  if (ariaRoot) {
    const ariaRows = [...ariaRoot.querySelectorAll('[role="row"]')].map((tr) =>
      [...tr.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"]')].map(txt)
    );
    push(ariaRows, ariaRoot);
  }
  document.querySelectorAll("[data-ce-grid]").forEach((el) => el.removeAttribute("data-ce-grid"));
  roots.forEach((el, i) => {
    if (!el) return;
    el.setAttribute("data-ce-grid", String(i));
    el.style.outline = "2px dashed #3b82f6";
    el.style.outlineOffset = "2px";
  });
  return grids;
}"""

BANNER_JS = """() => {
  if (document.getElementById("ce-excel-picker-bar")) return;
  let b = document.getElementById("ce-excel-banner");
  if (!b) {
    b = document.createElement("div");
    b.id = "ce-excel-banner";
    b.setAttribute("style",
      "position:fixed;top:8px;right:8px;z-index:2147483647;max-width:280px;padding:8px 10px;" +
      "background:#1e3a5f;color:#fff;font:12px/1.4 sans-serif;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);"
    );
    (document.body || document.documentElement).appendChild(b);
  }
  b.textContent = "Claude Excel 跟手取数：点选/框选和写入都在本窗口完成，不必回到 Excel。翻页请先点「浏览/翻页」。";
}"""

HIGHLIGHT_JS = """(i) => {
  document.querySelectorAll("[data-ce-grid]").forEach((el) => {
    const on = el.getAttribute("data-ce-grid") === String(i);
    el.style.outline = on ? "3px solid #2563eb" : "2px dashed #93c5fd";
    el.style.outlineOffset = "2px";
  });
}"""

BOX_INSTALL_JS = Path(__file__).with_name("box_select.js").read_text(encoding="utf-8")
BOX_STATUS_JS = """() => window.__ceManual || { pending: true }"""
_EXT = Path(__file__).resolve().parent.parent / "extension"
PICKER_UI_VER = "0.4.9"
PICKER_BOOT_JS = """
(function () {
  var boot = function () {
    try {
      if (typeof ceInstallPagePicker === "function") ceInstallPagePicker({ via: "playwright", collapsed: false });
    } catch (e) {}
  };
  if (document.body) boot();
  else document.addEventListener("DOMContentLoaded", boot, { once: true });
})();
"""
STRIP_OLD_PICKER_JS = """() => {
  try {
    if (window.__cePickerCtl && typeof window.__cePickerCtl.teardown === "function") window.__cePickerCtl.teardown();
  } catch (e) {}
  ["ce-excel-picker-bar", "ce-excel-picker-style", "ce-excel-banner"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });
}"""
PAGE_PICKER_VER_JS = """() => {
  const bar = document.getElementById("ce-excel-picker-bar");
  return String(window.__cePickerVer || (bar && bar.getAttribute("data-ce-ver")) || "");
}"""


def _picker_bundle() -> str:
    return "\n".join(
        [
            (_EXT / "json-table.js").read_text(encoding="utf-8"),
            (_EXT / "net-hook.js").read_text(encoding="utf-8"),
            (_EXT / "picker-core.js").read_text(encoding="utf-8"),
            (_EXT / "picker.js").read_text(encoding="utf-8"),
        ]
    )
PICKER_TAKE_JS = """() => {
  const p = window.__cePicker;
  if (!p || typeof p.takeCommand !== "function") return null;
  return p.takeCommand();
}"""


@dataclass
class FetchSession:
    id: str
    playwright: Any
    browser: Any
    context: Any
    page: Any
    created: float
    last_used: float
    grids: list
    boxed: bool = False
    engine: str = "chromium"
    recipe: dict | None = None


_lock = asyncio.Lock()
_session: FetchSession | None = None


async def close_all_sessions() -> None:
    async with _lock:
        await _close_unlocked()


async def _close_unlocked() -> None:
    global _session
    sess = _session
    _session = None
    if not sess:
        return
    try:
        await sess.context.close()
    except Exception:
        pass
    try:
        await sess.playwright.stop()
    except Exception:
        pass


async def _launch_context(pw: Any, headed: bool) -> tuple[Any, str]:
    PROFILE_DIR.mkdir(parents=True, exist_ok=True)
    opts: dict[str, Any] = {
        "user_data_dir": str(PROFILE_DIR),
        "headless": not headed,
        "locale": "zh-CN",
        "viewport": {"width": 1280, "height": 800},
        "ignore_default_args": ["--enable-automation"],
    }
    last: BaseException | None = None
    for channel in ("chrome", "msedge", None):
        try:
            kwargs = dict(opts)
            if channel:
                kwargs["channel"] = channel
            ctx = await pw.chromium.launch_persistent_context(**kwargs)
            return ctx, channel or "chromium"
        except Exception as exc:
            last = exc
    raise last or RuntimeError("browser launch failed")


async def open_fetch_session(
    url: str,
    username: str | None = None,
    password: str | None = None,
    headed: bool = True,
) -> dict[str, Any]:
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        return {"error": PLAYWRIGHT_HINT}

    user = str(username or "").strip()
    secret = str(password or "")
    async with _lock:
        await _close_unlocked()
        pw = None
        context = None
        try:
            pw = await async_playwright().start()
            context, engine = await _launch_context(pw, headed)
            try:
                await context.add_init_script(_picker_bundle() + "\n" + PICKER_BOOT_JS)
            except Exception:
                pass
            page = context.pages[0] if context.pages else await context.new_page()
            page.set_default_timeout(20000)
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
            await _maybe_login(page, user, secret)
            try:
                await _ensure_picker_unlocked(page, force=True)
            except Exception:
                try:
                    await page.evaluate(BANNER_JS)
                except Exception:
                    pass
        except Exception as exc:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
            if pw is not None:
                try:
                    await pw.stop()
                except Exception:
                    pass
            msg = str(exc)
            if "Executable doesn't exist" in msg or "playwright install" in msg.lower():
                return {"error": PLAYWRIGHT_HINT}
            return {"error": "浏览器打开失败：" + msg.split("\n")[0][:180] + "。不要把密码发到对话。"}
        sid = secrets.token_urlsafe(12)
        now = time.time()
        recipe = default_recipe(url)
        global _session
        _session = FetchSession(
            id=sid,
            playwright=pw,
            browser=getattr(context, "browser", None),
            context=context,
            page=page,
            created=now,
            last_used=now,
            grids=[],
            engine=engine,
            recipe=recipe,
        )
        return {
            "waitingConfirm": True,
            "sessionId": sid,
            "url": page.url,
            "sheetName": sheet_name_from_url(page.url),
            "keepOpen": True,
            "engine": engine,
        }


def _get_live(session_id: str) -> FetchSession | None:
    sess = _session
    if not sess or sess.id != session_id:
        return None
    if time.time() - sess.last_used > SESSION_TTL_SEC:
        return None
    sess.last_used = time.time()
    return sess


async def scan_fetch_session(session_id: str) -> dict[str, Any]:
    async with _lock:
        sess = _get_live(session_id)
        if not sess:
            return {"error": "取数窗口已关闭或超时。请重新点取数打开浏览器。"}
        try:
            try:
                await sess.page.evaluate(BANNER_JS)
            except Exception:
                pass
            grids = await sess.page.evaluate(EXTRACT_AND_MARK_JS)
            html = await sess.page.content()
        except Exception as exc:
            return {"error": "扫描失败：" + str(exc).split("\n")[0][:180]}
        tables = extract_html_tables(html)
        all_grids = list(grids or []) + tables
        sess.grids = all_grids
        sess.boxed = False
        items = summarize_grids(all_grids)
        if not items:
            still = await _visible_password_count(sess.page)
            if still:
                return {
                    "error": "还在登录页。请在弹出窗口里完成登录和验证码，打开报表并等数据刷完，再点扫描。"
                    "不要把密码发到对话。"
                }
            return {"waitingConfirm": True, "sessionId": session_id, "grids": [], "url": sess.page.url}
        return {
            "waitingConfirm": True,
            "sessionId": session_id,
            "url": sess.page.url,
            "sheetName": sheet_name_from_url(sess.page.url),
            "grids": items,
        }


async def highlight_fetch_session(session_id: str, grid_index: int) -> dict[str, Any]:
    async with _lock:
        sess = _get_live(session_id)
        if not sess:
            return {"error": "取数窗口已关闭或超时。请重新点取数打开浏览器。"}
        try:
            await sess.page.evaluate(HIGHLIGHT_JS, int(grid_index))
        except Exception:
            pass
        return {"ok": True}


async def capture_fetch_session(
    session_id: str,
    grid_index: int | None = None,
    row_from: str | None = None,
    row_to: str | None = None,
    col_from: str | None = None,
    col_to: str | None = None,
    live: bool = False,
) -> dict[str, Any]:
    async with _lock:
        sess = _get_live(session_id)
        if not sess:
            return {"error": "取数窗口已关闭或超时。请重新点取数打开浏览器。"}
        try:
            if sess.boxed and sess.grids and not live:
                all_grids = list(sess.grids)
                final_url = sess.page.url
            else:
                grids = await sess.page.evaluate(EXTRACT_AND_MARK_JS)
                html = await sess.page.content()
                final_url = sess.page.url
                all_grids = list(grids or []) + extract_html_tables(html)
                sess.grids = all_grids
                sess.boxed = False
        except Exception as exc:
            return {"error": "抓取失败：" + str(exc).split("\n")[0][:180] + "。窗口仍开着，可再试。"}
        if not all_grids:
            still = await _visible_password_count(sess.page)
            if still:
                return {
                    "error": "还在登录页。请在窗口里完成登录和验证码后再抓。"
                    "不要把密码发到对话。"
                }
            return {
                "error": "当前页没有解析到表格。请等数据刷完后扫描或框选，再确认。"
                "若站点提供导出 Excel，请在窗口里导出。"
            }
        idx = 0 if grid_index is None else int(grid_index)
        if idx < 0 or idx >= len(all_grids):
            rows = pick_largest_grid(all_grids)
        else:
            rows = all_grids[idx]
        rows = slice_grid(rows, row_from, row_to, col_from, col_to)
        if not rows:
            return {"error": "所选范围是空的。请调整行/列范围后再确认抓取。"}
        recipe = validate_recipe(sess.recipe or default_recipe(final_url))
        recipe["url"] = final_url
        recipe["extract"] = {
            **recipe["extract"],
            "mode": "box" if sess.boxed else "table",
            "gridIndex": idx,
            "rowFrom": str(row_from or "1"),
            "rowTo": str(row_to or ""),
            "colFrom": str(col_from or "A"),
            "colTo": str(col_to or ""),
        }
        recipe["iterate"]["type"] = "manual"
        sess.recipe = recipe
        try:
            save_recipe(recipe)
        except OSError:
            pass
        return {
            "url": final_url,
            "sheetName": sheet_name_from_url(final_url),
            "rows": rows[:500],
            "truncated": len(rows) > 500,
            "keepOpen": True,
            "engine": sess.engine,
        }


async def start_box_select(session_id: str) -> dict[str, Any]:
    async with _lock:
        sess = _get_live(session_id)
        if not sess:
            return {"error": "取数窗口已关闭或超时。请重新点取数打开浏览器。"}
        try:
            await _ensure_picker_unlocked(sess.page, "box", force=True)
        except Exception as exc:
            return {"error": "无法开始框选：" + str(exc).split("\n")[0][:180]}
        return {"ok": True, "boxing": True}


async def start_page_picker(session_id: str, mode: str | None = None) -> dict[str, Any]:
    async with _lock:
        sess = _get_live(session_id)
        if not sess:
            return {"error": "取数窗口已关闭或超时。请重新点取数打开浏览器。"}
        try:
            await _ensure_picker_unlocked(sess.page, mode, force=True)
        except Exception as exc:
            return {"error": "无法打开选取条：" + str(exc).split("\n")[0][:180]}
        return {"ok": True, "picking": True}


async def picker_status(session_id: str) -> dict[str, Any]:
    async with _lock:
        sess = _get_live(session_id)
        if not sess:
            return {"error": "取数窗口已关闭或超时。请重新点取数打开浏览器。"}
        try:
            closed = bool(await sess.page.evaluate("() => !!window.__cePickerClosed"))
            cmd = await sess.page.evaluate(PICKER_TAKE_JS)
            if not closed:
                await _ensure_picker_unlocked(sess.page)
        except Exception:
            return {"pending": True, "sessionId": session_id}
        if closed and not (isinstance(cmd, dict) and cmd.get("type") in ("write", "append")):
            return {"pending": True, "pickerOff": True}
        if not isinstance(cmd, dict) or not cmd.get("type"):
            return {"pending": True, "sessionId": session_id}
        kind = str(cmd.get("type") or "")
        if kind == "close":
            return {"pending": True, "pickerOff": True}
        grids = cmd.get("grids") if isinstance(cmd.get("grids"), list) else []
        rows = cmd.get("rows") if isinstance(cmd.get("rows"), list) else []
        if not rows:
            rows = merge_grids(grids)
        if not rows and isinstance(cmd.get("cells"), list):
            rows = cells_to_grid(cmd.get("cells"))
        if not rows:
            return {"pending": True, "error": "还没有选中内容。请在网页窗口点选或框选后再写入。"}
        fields = cmd.get("fields") if isinstance(cmd.get("fields"), list) else []
        has_head = bool(cmd.get("hasHead"))
        column_labels = cmd.get("columnLabels") if isinstance(cmd.get("columnLabels"), list) else []
        extract_mode = str(cmd.get("extractMode") or "picker")
        pushed = push_ingest(
            {
                "url": sess.page.url,
                "rows": rows,
                "append": kind == "append",
                "sheetName": sheet_name_from_url(sess.page.url),
                "fields": fields,
                "hasHead": has_head,
                "columnLabels": column_labels,
                "extractMode": extract_mode,
            }
        )
        if pushed.get("error"):
            return {"pending": True, "error": pushed["error"]}
        try:
            sess.recipe = load_recipe(sess.page.url)
        except OSError:
            sess.recipe = validate_recipe(sess.recipe or default_recipe(sess.page.url))
        return {
            "pending": True,
            "pushed": True,
            "append": bool(pushed.get("append")),
            "sheetName": pushed.get("sheetName"),
            "rows": pushed.get("rows"),
            "recipePath": pushed.get("recipePath") or "",
            "stepsMarkdown": pushed.get("stepsMarkdown") or "",
        }


def _ver_tuple(text: str) -> tuple[int, ...]:
    out: list[int] = []
    buf = ""
    for ch in str(text or ""):
        if ch.isdigit():
            buf += ch
        elif buf:
            out.append(int(buf))
            buf = ""
    if buf:
        out.append(int(buf))
    return tuple(out) if out else (0,)


async def _page_picker_ver(page: Any) -> str:
    try:
        return str(await page.evaluate(PAGE_PICKER_VER_JS) or "")
    except Exception:
        return ""


async def _ensure_picker_unlocked(page: Any, mode: str | None = None, force: bool = False) -> None:
    if not force:
        try:
            if bool(await page.evaluate("() => !!window.__cePickerClosed")):
                return
        except Exception:
            pass
    exists = False
    try:
        exists = bool(await page.evaluate("() => !!document.getElementById('ce-excel-picker-bar')"))
    except Exception:
        exists = False
    ver = await _page_picker_ver(page)
    need_upgrade = exists and ver and _ver_tuple(ver) < _ver_tuple(PICKER_UI_VER)
    opts: dict[str, Any] = {"via": "playwright", "collapsed": False}
    if mode:
        opts["mode"] = mode
    if (not exists) or need_upgrade:
        try:
            await page.evaluate(STRIP_OLD_PICKER_JS)
        except Exception:
            pass
        await page.add_script_tag(content=_picker_bundle())
        await page.evaluate("(o) => ceInstallPagePicker(o)", opts)
        return
    if mode:
        await page.evaluate("(m) => window.__cePickerCtl && window.__cePickerCtl.setMode(m)", mode)


async def box_select_status(session_id: str) -> dict[str, Any]:
    async with _lock:
        sess = _get_live(session_id)
        if not sess:
            return {"error": "取数窗口已关闭或超时。请重新点取数打开浏览器。"}
        try:
            state = await sess.page.evaluate(BOX_STATUS_JS)
        except Exception as exc:
            return {"error": "读取框选失败：" + str(exc).split("\n")[0][:180]}
        if not isinstance(state, dict):
            return {"pending": True}
        if state.get("pending"):
            return {"pending": True}
        if state.get("cancelled"):
            return {"pending": False, "cancelled": True, "grids": []}
        grid = cells_to_grid(state.get("cells") or [])
        sess.grids = [grid] if grid else []
        sess.boxed = bool(grid)
        items = summarize_grids(sess.grids)
        return {
            "pending": False,
            "cancelled": False,
            "sessionId": session_id,
            "url": sess.page.url,
            "sheetName": sheet_name_from_url(sess.page.url),
            "grids": items,
        }


async def cancel_fetch_session(session_id: str) -> dict[str, Any]:
    async with _lock:
        sess = _session
        if sess and sess.id == session_id:
            await _close_unlocked()
        return {"ok": True}


async def _visible_password_count(page: Any) -> int:
    return int(
        await page.evaluate(
            """() => [...document.querySelectorAll('input[type="password"]')]
              .filter((el) => el.offsetParent !== null).length"""
        )
    )


async def _has_captcha(page: Any) -> bool:
    loc = page.locator(
        'input[placeholder*="验证码"], input[name*="captcha" i], input[name*="verify" i], '
        'img[alt*="验证"], .geetest, .slider-verify, .nc_wrapper, .captcha, .vcode'
    )
    return await loc.count() > 0


async def _maybe_login(page: Any, user: str, secret: str) -> None:
    pwd = page.locator('input[type="password"]')
    if await pwd.count() == 0:
        return
    box = pwd.first
    try:
        await box.wait_for(state="visible", timeout=8000)
    except Exception:
        return
    if user:
        user_box = page.locator(
            'input[type="text"], input[type="tel"], input[type="number"], '
            'input[name*="user" i], input[name*="account" i], input[name*="phone" i], '
            'input[placeholder*="用户"], input[placeholder*="账号"], input[placeholder*="手机"]'
        ).first
        try:
            await user_box.fill(user, timeout=5000)
        except Exception:
            pass
    if not secret:
        return
    await box.fill(secret)
    if await _has_captcha(page):
        return
    btn = page.locator('button[type="submit"], input[type="submit"], button:has-text("登录")').first
    try:
        await btn.click(timeout=5000)
    except Exception:
        await box.press("Enter")
    await page.wait_for_timeout(800)
