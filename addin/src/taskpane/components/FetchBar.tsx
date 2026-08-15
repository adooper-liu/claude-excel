/**
 * Local URL fetch. Opens browser picker on this machine — credentials stay in the browser, not in chat.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyFetchUrlPreset,
  groupFetchUrlPresets,
  presetShortLabel,
  type FetchUrlPreset,
} from "../../services/fetch-url-presets";

export type FetchRows = (string | number)[][];

interface Props {
  disabled: boolean;
  onFetched: (rows: FetchRows, sheetName: string, opts?: { append?: boolean }) => Promise<string | void>;
}

type Phase = "idle" | "opening" | "picking";

const API = "https://localhost:8765";

async function postJson(path: string, body: object, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal,
    body: JSON.stringify(body),
  });
  return r.json();
}

export default function FetchBar({ disabled, onFetched }: Props): JSX.Element {
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [writtenSheet, setWrittenSheet] = useState("");
  const [note, setNote] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const comboRef = useRef<HTMLDivElement>(null);

  const busy = phase === "opening";
  const picking = phase === "picking";
  const inputLocked = disabled || busy || picking;

  const presetGroups = useMemo(function () {
    if (!menuOpen) return groupFetchUrlPresets("");
    const q = url.trim();
    if (!q || /^https?:\/\//i.test(q)) return groupFetchUrlPresets("");
    return groupFetchUrlPresets(q);
  }, [menuOpen, url]);

  const resetPick = useCallback(() => {
    setSessionId("");
    setWrittenSheet("");
    setNote("");
    setPhase("idle");
  }, []);

  const cancel = useCallback(async () => {
    const sid = sessionId;
    resetPick();
    setErr("");
    if (sid) {
      try {
        await postJson("/api/web-fetch-cancel", { sessionId: sid });
      } catch {
        /* ignore */
      }
    }
  }, [sessionId, resetPick]);

  const writeRows = useCallback(
    async (data: Record<string, unknown>, append: boolean) => {
      const rows = Array.isArray(data.rows) ? (data.rows as FetchRows) : [];
      if (!rows.length) {
        setErr("网页还没有可写的数据。请在右侧取数卡片里点选、框选或等接口表出现后再写入。");
        return false;
      }
      const sheetName =
        (append && writtenSheet) || String(data.sheetName || "取数").trim() || "取数";
      const actual = (await onFetched(rows, sheetName, { append })) || sheetName;
      if (!append) setWrittenSheet(actual);
      return true;
    },
    [onFetched, writtenSheet]
  );

  const pickPreset = useCallback(function (preset: FetchUrlPreset) {
    setUrl(applyFetchUrlPreset(preset));
    setMenuOpen(false);
    setErr("");
  }, []);

  const run = useCallback(async () => {
    const target = url.trim();
    if (!target || busy || disabled) return;
    setMenuOpen(false);
    setPhase("opening");
    setErr("");
    setNote("");
    const ac = new AbortController();
    const timer = window.setTimeout(() => ac.abort(), 90000);
    try {
      const data = await postJson(
        "/api/web-fetch",
        {
          url: target,
          asRows: true,
          browser: true,
        },
        ac.signal
      );
      if (data && data.error) {
        setErr(String(data.error));
        setPhase("idle");
        return;
      }
      if (data.waitingConfirm && data.sessionId) {
        setSessionId(String(data.sessionId));
        setWrittenSheet("");
        setPhase("picking");
        return;
      }
      await writeRows(data, false);
      setPhase("idle");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(/abort/i.test(msg) ? "打开超时。请重试；验证码请在弹出窗口里完成。" : msg);
      setPhase("idle");
    } finally {
      window.clearTimeout(timer);
    }
  }, [url, busy, disabled, writeRows]);

  useEffect(() => {
    let stop = false;
    if (!sessionId || phase === "idle" || phase === "opening") {
      return () => {
        stop = true;
      };
    }
    const tick = (): void => {
      if (stop) return;
      void postJson("/api/web-fetch-picker-status", { sessionId })
        .then((data) => {
          if (stop) return;
          if (data && data.error && /已关闭或超时/.test(String(data.error))) {
            setErr(String(data.error));
            return;
          }
          if (data && data.error) setErr(String(data.error));
          if (data && data.pushed) {
            const name = String(data.sheetName || writtenSheet || "取数");
            if (!data.append) setWrittenSheet(name);
            setNote(data.append ? `已追加到「${name}」。可在网页翻页后再追加。` : `已写入「${name}」。翻页后在网页点追加。`);
            setErr("");
          }
          if (!stop) window.setTimeout(tick, 500);
        })
        .catch(() => {
          if (!stop) window.setTimeout(tick, 1000);
        });
    };
    const delay = window.setTimeout(tick, 400);
    return () => {
      stop = true;
      window.clearTimeout(delay);
    };
  }, [sessionId, phase, writtenSheet]);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }
    const onDoc = (ev: MouseEvent) => {
      const el = comboRef.current;
      if (el && !el.contains(ev.target as Node)) setMenuOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div className={"fetch-bar" + (menuOpen ? " fetch-bar-menu-open" : "")}>
      <div className="fetch-row">
        <div className={"fetch-url-combo" + (menuOpen ? " is-open" : "")} ref={comboRef}>
          <input
            type="url"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (!menuOpen) setMenuOpen(true);
            }}
            onFocus={() => {
              if (!inputLocked) setMenuOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && !menuOpen) setMenuOpen(true);
            }}
            placeholder="https:// 或点 ▾ 选快捷路径"
            disabled={inputLocked}
            aria-label="取数网址"
            aria-expanded={menuOpen}
            aria-haspopup="listbox"
            autoComplete="off"
          />
          <button
            type="button"
            className="fetch-url-toggle"
            onClick={() => setMenuOpen(function (v) {
              return !v;
            })}
            disabled={inputLocked}
            aria-label="展开快捷路径"
            aria-expanded={menuOpen}
          >
            ▾
          </button>
          {menuOpen && !inputLocked && (
            <div className="fetch-url-menu" role="listbox" aria-label="快捷路径">
              {presetGroups.map(function (g) {
                return (
                  <div key={g.id} className="fetch-url-group" role="group" aria-label={g.label}>
                    <div className="fetch-url-group-label">{g.label}</div>
                    {g.items.map(function (p) {
                      return (
                        <div
                          key={p.id}
                          className="fetch-url-option"
                          role="option"
                          tabIndex={-1}
                          title={p.hint || p.url}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickPreset(p)}
                        >
                          {presetShortLabel(p)}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {!presetGroups.length && <div className="fetch-url-empty">没有匹配的快捷路径</div>}
            </div>
          )}
        </div>
        {!picking && (
          <button type="button" onClick={run} disabled={disabled || busy || !url.trim()}>
            {phase === "opening" ? "正在打开…" : "取数"}
          </button>
        )}
        {picking && (
          <button type="button" className="fetch-btn-ghost" onClick={cancel} disabled={disabled}>
            {writtenSheet ? "结束" : "取消"}
          </button>
        )}
      </div>
      {!picking && (
        <p className="fetch-hint">可手工输入网址，或选快捷路径后改「关键词 / ASIN」。登录在弹出浏览器里完成。</p>
      )}
      {picking && writtenSheet && (
        <p className="fetch-hint">
          {`已写入「${writtenSheet}」。翻页请在网页切到「浏览/翻页」，再点选或追加。点结束才关浏览器。`}
        </p>
      )}
      {note && <p className="fetch-ok">{note}</p>}
      {err && <p className="fetch-err">{err}</p>}
    </div>
  );
}
