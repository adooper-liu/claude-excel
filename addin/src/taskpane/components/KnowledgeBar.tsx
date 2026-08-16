/**
 * KnowledgeBar — upload and manage local RAG documents.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

const API = "https://localhost:8765";

export type KnowledgeDoc = {
  id: string;
  name: string;
  bytes: number;
  chunk_count: number;
  indexed_at: string;
};

export type KnowledgeStatus = {
  docCount: number;
  chunkCount: number;
  embeddingMode: "api" | "local";
  embeddingModel?: string | null;
};

interface Props {
  disabled: boolean;
}

async function readJson(r: Response): Promise<Record<string, unknown>> {
  const text = await r.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { detail: text };
  }
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  const r = await fetch(API + path);
  const data = await readJson(r);
  if (!r.ok) {
    const detail = (data as { detail?: string }).detail;
    if (r.status === 404) {
      throw new Error("知识库接口未就绪。请重启本机后端（launch.bat 或 python backend/server.py）。");
    }
    throw new Error(String(detail || r.statusText || "请求失败"));
  }
  return data;
}

async function postJson(path: string, body: object): Promise<Record<string, unknown>> {
  const r = await fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await readJson(r);
  if (!r.ok) {
    const detail = (data as { detail?: string }).detail;
    if (r.status === 405 || r.status === 404) {
      throw new Error("知识库接口未就绪。请重启本机后端后再试。");
    }
    throw new Error(String(detail || r.statusText || "上传失败"));
  }
  return data;
}

async function del(path: string): Promise<void> {
  const r = await fetch(API + path, { method: "DELETE" });
  if (!r.ok) {
    const data = await readJson(r);
    const err = (data as { detail?: string }).detail || r.statusText;
    throw new Error(String(err));
  }
}

function pickFileFromDrop(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  if (dt.files && dt.files.length > 0) return dt.files[0];
  const item = dt.items && dt.items[0];
  if (item && item.kind === "file") return item.getAsFile();
  return null;
}

export default function KnowledgeBar({ disabled }: Props): JSX.Element {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [pathDraft, setPathDraft] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getJson("/api/knowledge");
      setDocs((data.documents as KnowledgeDoc[]) || []);
      setStatus((data.status as KnowledgeStatus) || null);
      setErr("");
    } catch (e) {
      setStatus(null);
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const ingestFile = useCallback(
    async (file: File) => {
      if (disabled || busy) return;
      const name = file.name || "note.md";
      if (!/\.(md|markdown|txt|csv)$/i.test(name)) {
        setErr("仅支持 .md / .txt / .markdown / .csv");
        return;
      }
      setBusy(true);
      setErr("");
      try {
        const text = await file.text();
        await postJson("/api/knowledge", { filename: name, content: text });
        await refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, disabled, refresh]
  );

  const ingestPath = useCallback(async () => {
    const path = pathDraft.trim();
    if (!path || disabled || busy) return;
    setBusy(true);
    setErr("");
    try {
      await postJson("/api/knowledge/from-path", { path });
      setPathDraft("");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pathDraft, disabled, busy, refresh]);

  const onFilePick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void ingestFile(file);
      e.target.value = "";
    },
    [ingestFile]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      const file = pickFileFromDrop(e.dataTransfer);
      if (!file) {
        setErr("拖放失败：未识别到文件。请用「浏览文件」选择，或填写本机路径。");
        return;
      }
      void ingestFile(file);
    },
    [ingestFile]
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (disabled || busy) return;
      setBusy(true);
      setErr("");
      try {
        await del("/api/knowledge/" + encodeURIComponent(id));
        await refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, disabled, refresh]
  );

  const modeLabel =
    status?.embeddingMode === "api"
      ? "API 向量（" + (status.embeddingModel || "embedding") + "）"
      : "本机哈希向量（可在 config.json 设 embeddingModel 启用 API）";

  return (
    <div className="fetch-bar knowledge-bar">
      <div className="fetch-row knowledge-head">
        <span className="knowledge-title">本机知识库</span>
        <span className="knowledge-meta">
          {status ? status.docCount + " 篇 · " + status.chunkCount + " 段 · " + modeLabel : err ? "未连接后端" : "加载中…"}
        </span>
      </div>
      <div
        className={"skill-upload-zone knowledge-upload" + (dragOver ? " knowledge-drag-over" : "")}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,.txt,.csv,text/plain,text/markdown"
          className="skill-file-input"
          onChange={onFilePick}
          aria-hidden
          tabIndex={-1}
        />
        <div className="knowledge-upload-actions">
          <button
            type="button"
            className="knowledge-upload-btn"
            disabled={disabled || busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? "索引中…" : "浏览文件"}
          </button>
          <span className="skill-upload-sub">或拖放 .md / .txt / .csv 到此处</span>
        </div>
      </div>
      <div className="knowledge-path-row">
        <input
          type="text"
          className="knowledge-path-input"
          value={pathDraft}
          disabled={disabled || busy}
          placeholder="本机路径，如 D:\\docs\\SOP.md"
          aria-label="本机文件路径"
          onChange={(e) => setPathDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ingestPath();
          }}
        />
        <button
          type="button"
          className="fetch-btn-ghost"
          disabled={disabled || busy || !pathDraft.trim()}
          onClick={() => void ingestPath()}
        >
          从路径索引
        </button>
      </div>
      {docs.length > 0 && (
        <ul className="knowledge-doc-list">
          {docs.map(function (d) {
            return (
              <li key={d.id}>
                <span className="knowledge-doc-name" title={d.name}>
                  {d.name}
                </span>
                <span className="knowledge-doc-meta">
                  {Math.max(1, Math.round((d.bytes || 0) / 1024))}KB · {d.chunk_count || 0} 段
                </span>
                <button
                  type="button"
                  className="prompt-del"
                  disabled={disabled || busy}
                  aria-label={"删除 " + d.name}
                  onClick={() => void onDelete(d.id)}
                >
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {err && <p className="skill-install-err">{err}</p>}
      <p className="skill-install-note">索引副本存于 ~/.claude-excel-web/knowledge/。对话用 /知识 或 search_knowledge 检索。</p>
    </div>
  );
}
