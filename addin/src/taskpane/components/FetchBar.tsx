/**
 * Local URL fetch. Credentials POST to this machine only — never into chat.
 * Pick / box / write happen on the web page. This bar only opens the session and ends it.
 */

import React, { useCallback, useEffect, useState } from "react";

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
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [writtenSheet, setWrittenSheet] = useState("");
  const [engine, setEngine] = useState("");
  const [note, setNote] = useState("");

  const busy = phase === "opening";
  const picking = phase === "picking";

  const resetPick = useCallback(() => {
    setSessionId("");
    setWrittenSheet("");
    setEngine("");
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

  const run = useCallback(async () => {
    const target = url.trim();
    if (!target || busy || disabled) return;
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
          username: user.trim(),
          password,
          asRows: true,
          browser: showAuth,
        },
        ac.signal
      );
      if (data && data.error) {
        setErr(String(data.error));
        if (/登录|验证码|密码|浏览器/.test(String(data.error))) setShowAuth(true);
        setPhase("idle");
        return;
      }
      if (data.waitingConfirm && data.sessionId) {
        setPassword("");
        setSessionId(String(data.sessionId));
        setWrittenSheet("");
        setEngine(String(data.engine || ""));
        setPhase("picking");
        return;
      }
      const ok = await writeRows(data, false);
      setPhase("idle");
      if (ok) setPassword("");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(/abort/i.test(msg) ? "打开超时。请重试；验证码请在弹出窗口里完成。" : msg);
      setPhase("idle");
    } finally {
      window.clearTimeout(timer);
    }
  }, [url, user, password, showAuth, busy, disabled, writeRows]);

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

  const where = engine === "chromium" ? "弹出窗口" : "本机 Chrome/Edge";

  return (
    <div className="fetch-bar">
      <div className="fetch-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https:// 含 ERP 控制台；登录在本机浏览器完成"
          disabled={disabled || busy || picking}
          aria-label="取数网址"
        />
        {!picking && (
          <button type="button" onClick={run} disabled={disabled || busy || !url.trim()}>
            {phase === "opening" ? (showAuth ? "正在打开…" : "取数中") : "取数"}
          </button>
        )}
        {picking && (
          <button type="button" className="fetch-btn-ghost" onClick={cancel} disabled={disabled}>
            {writtenSheet ? "结束" : "取消"}
          </button>
        )}
      </div>
      <label className="fetch-auth-toggle">
        <input
          type="checkbox"
          checked={showAuth}
          onChange={(e) => setShowAuth(e.target.checked)}
          disabled={disabled || busy || picking}
        />
        需要登录 / 三方站（本机 Chrome 或 Edge，密码不进对话）
      </label>
      {showAuth && !picking && (
        <p className="fetch-hint">用本机 Chrome/Edge 打开。验证码自己点。点选、框选、翻页、写入都在网页右侧完成。</p>
      )}
      {showAuth && !picking && (
        <div className="fetch-row">
          <input
            type="text"
            autoComplete="username"
            value={user}
            onChange={(e) => setUser(e.target.value)}
            placeholder="用户名"
            disabled={disabled || busy}
            aria-label="取数用户名"
          />
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码（可空，改在弹出窗口里登）"
            disabled={disabled || busy}
            aria-label="取数密码"
          />
        </div>
      )}
      {picking && (
        <p className="fetch-hint">
          {writtenSheet
            ? `已写入「${writtenSheet}」。翻页请在网页切到「浏览/翻页」，再点选或追加。点结束才关浏览器。`
            : `请在${where}右侧「取数」卡片操作：点选 / 框选 / 浏览/翻页。写入也在网页上，不必回到 Excel。`}
        </p>
      )}
      {note && <p className="fetch-ok">{note}</p>}
      {err && <p className="fetch-err">{err}</p>}
    </div>
  );
}
