/**
 * KnowledgeBar — read-only view of local RAG documents. Uploading goes through PdfAttachSection.
 */

import React, { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../../services/api-config";

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
  const r = await fetch(API_BASE + path);
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

async function del(path: string): Promise<void> {
  const r = await fetch(API_BASE + path, { method: "DELETE" });
  if (!r.ok) {
    const data = await readJson(r);
    const err = (data as { detail?: string }).detail || r.statusText;
    throw new Error(String(err));
  }
}

export default function KnowledgeBar({ disabled }: Props): JSX.Element {
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

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
      {docs.length > 0 ? (
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
      ) : (
        !err && <p className="skill-install-note">还没有文档。用「附加文档」上传 PDF / 图片 / .md/.txt/.csv，正文会自动入知识库。</p>
      )}
      {err && <p className="skill-install-err">{err}</p>}
      <p className="skill-install-note">索引副本存于 ~/.claude-excel-web/knowledge/。对话用 /知识 或 search_knowledge 检索。</p>
    </div>
  );
}
