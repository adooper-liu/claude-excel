/**
 * PdfAttachSection — attach a document (PDF / image / text), then let the user
 * choose where it lands: text -> knowledge base, table -> a new sheet (or both).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../services/api-config";
import { writeToNewSheet } from "../../excel";
import { type DocRecipeSummary } from "./DocRecipeBar";

type OcrBackend = "local" | "cloud";

type PdfResult = {
  kind: "text" | "table" | "scanned";
  text?: string | null;
  rows?: unknown;
  sheetName?: string;
  preview?: string;
  pages?: number;
  tables?: number;
  ocrBackend?: "local" | "cloud" | null;
  error?: string;
};

type PendingLand = {
  file: File;
  text?: string;
  rows?: (string | number)[][];
  sheetName?: string;
  ocrBackend?: "local" | "cloud" | null;
};

interface Props {
  disabled: boolean;
  refreshKey?: number;
}

const DOC_EXT = /\.(pdf|png|jpe?g|tiff?|bmp|md|markdown|txt|csv)$/i;
const TEXT_EXT = /\.(md|markdown|txt|csv)$/i;

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { detail: text };
  }
}

function postJson(path: string, body: object): Promise<Record<string, unknown>> {
  return fetch(API_BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (response) => {
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(String(data.detail || response.statusText || "请求失败"));
    }
    return data;
  });
}

function resultRows(data: PdfResult): (string | number)[][] {
  if (!Array.isArray(data.rows)) return [];
  return data.rows
    .filter(Array.isArray)
    .map((row) =>
      row.map((cell) =>
        cell === null || cell === undefined ? "" : typeof cell === "number" ? cell : String(cell)
      )
    );
}

function pickFileFromDrop(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  if (dt.files?.length) return dt.files[0];
  const item = dt.items?.[0];
  return item?.kind === "file" ? item.getAsFile() : null;
}

export default function PdfAttachSection({ disabled, refreshKey }: Props): JSX.Element {
  const [backend, setBackend] = useState<OcrBackend>("local");
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingResult, setPendingResult] = useState<PendingLand | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [templates, setTemplates] = useState<DocRecipeSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  const refreshTemplates = useCallback(async () => {
    try {
      const response = await fetch(API_BASE + "/api/doc-recipes");
      if (!response.ok) return;
      const data = (await response.json()) as { recipes?: DocRecipeSummary[] };
      setTemplates(data.recipes || []);
    } catch {
      // template selection is optional; keep the last known list
    }
  }, []);

  useEffect(function () {
    void refreshTemplates();
  }, [refreshTemplates, refreshKey]);

  const extract = useCallback(async (file: File, useBackend: OcrBackend): Promise<PdfResult> => {
    const form = new FormData();
    form.append("file", file);
    form.append("ocr_backend", useBackend);
    if (useBackend === "cloud") {
      form.append("cloudConfirmed", "true");
    }
    if (selectedTemplate) {
      form.append("template", selectedTemplate);
    }
    const response = await fetch(API_BASE + "/api/pdf/extract", {
      method: "POST",
      body: form,
    });
    const data = await readJson(response);
    if (!response.ok) {
      throw new Error(String(data.detail || response.statusText || "解析失败"));
    }
    return data as PdfResult;
  }, [selectedTemplate]);

  const process = useCallback(
    async (file: File, useBackend: OcrBackend) => {
      if (disabled || busy) return;
      setBusy(true);
      setErr("");
      setStatus("正在解析：" + file.name);
      try {
        if (TEXT_EXT.test(file.name)) {
          const text = await file.text();
          if (!text.trim()) throw new Error("文件没有可索引的正文");
          setPendingResult({ file, text });
        } else {
          const data = await extract(file, useBackend);
          const rows = resultRows(data);
          const text = String(data.text || "").trim();
          if (!rows.length && !text) {
            throw new Error(String(data.error || "没有可用的文本或表格。"));
          }
          setPendingResult({
            file,
            text: text || undefined,
            rows: rows.length ? rows : undefined,
            sheetName: String(data.sheetName || file.name).slice(0, 28),
            ocrBackend: data.ocrBackend,
          });
        }
        setPendingFile(null);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStatus("");
      } finally {
        setBusy(false);
      }
    },
    [busy, disabled, extract]
  );

  const landKnowledge = useCallback(async () => {
    const p = pendingResult;
    if (!p || !p.text || busy) return;
    setBusy(true);
    setErr("");
    try {
      const base = p.file.name.replace(DOC_EXT, "") || "document";
      const filename = TEXT_EXT.test(p.file.name) ? p.file.name : base + ".md";
      await postJson("/api/knowledge", { filename, content: p.text });
      const viaOcr = p.ocrBackend ? "（OCR：" + p.ocrBackend + "）" : "";
      setStatus("正文已入知识库，可在对话提问" + viaOcr);
      setPendingResult((prev) => (prev && prev.rows ? { ...prev, text: undefined } : null));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [pendingResult, busy]);

  const landSheet = useCallback(async () => {
    const p = pendingResult;
    if (!p || !p.rows || busy) return;
    setBusy(true);
    setErr("");
    try {
      // OCR 文本里 `=` 开头的单元格可能被 Excel 误当公式，加零宽前缀转文本
      const rows = p.rows.map((row) =>
        row.map((c) => (typeof c === "string" && c.startsWith("=") ? "​" + c : c))
      );
      const written = await writeToNewSheet(p.sheetName || "文档", rows);
      setStatus("表已进簿：「" + written + "」（" + p.rows.length + " 行）");
      setPendingResult((prev) => (prev && prev.text ? { ...prev, rows: undefined } : null));
    } catch (e) {
      const err = e as { code?: string; name?: string; message?: string; errorLocation?: string };
      const parts = [err.code, err.name, err.message, err.errorLocation].filter(Boolean);
      setErr(parts.join(" | ") || String(e));
    } finally {
      setBusy(false);
    }
  }, [pendingResult, busy]);

  const cancelLand = useCallback(() => {
    setPendingResult(null);
    setStatus("");
  }, []);

  const onFilePick = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (!DOC_EXT.test(file.name)) {
        setErr("请选择 PDF、图片或 .md/.txt/.csv 文件");
        setStatus("");
        return;
      }
      setErr("");
      setStatus("");
      if (backend === "cloud" && !TEXT_EXT.test(file.name)) {
        setPendingFile(file);
        return;
      }
      void process(file, "local");
    },
    [backend, process]
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragOver(false);
      const file = pickFileFromDrop(event.dataTransfer);
      if (!file) {
        setErr("拖放失败：未识别到文件。");
        return;
      }
      if (!DOC_EXT.test(file.name)) {
        setErr("请选择 PDF、图片或 .md/.txt/.csv 文件");
        return;
      }
      setErr("");
      setStatus("");
      if (backend === "cloud" && !TEXT_EXT.test(file.name)) {
        setPendingFile(file);
        return;
      }
      void process(file, "local");
    },
    [backend, process]
  );

  const switchBackend = useCallback(
    (next: OcrBackend) => {
      if (busy) return;
      setBackend(next);
      setPendingFile(null);
      setPendingResult(null);
      setErr("");
    },
    [busy]
  );

  return (
    <div className="fetch-bar pdf-bar">
      <div className="fetch-row pdf-head">
        <span className="pdf-title">附加文档</span>
        <div className="pdf-mode" role="group" aria-label="OCR 方式">
          <button
            type="button"
            className={backend === "local" ? "on" : ""}
            onClick={() => switchBackend("local")}
            disabled={disabled || busy}
            aria-pressed={backend === "local"}
          >
            本机 OCR
          </button>
          <button
            type="button"
            className={backend === "cloud" ? "on" : ""}
            onClick={() => switchBackend("cloud")}
            disabled={disabled || busy}
            aria-pressed={backend === "cloud"}
          >
            云端 OCR
          </button>
        </div>
      </div>

      <div className="fetch-row pdf-template-row">
        <label className="pdf-template-label" htmlFor="pdf-template-select">
          模板
        </label>
        <select
          id="pdf-template-select"
          className="pdf-template-select"
          value={selectedTemplate}
          onChange={(e) => setSelectedTemplate(e.target.value)}
          disabled={disabled || busy}
          aria-label="识别模板"
        >
          <option value="">无模板（原始提取）</option>
          {templates.map(function (t) {
            return (
              <option key={t.name} value={t.name}>
                {t.name}（{t.fieldCount} 字段）
              </option>
            );
          })}
        </select>
      </div>

      <div
        className={"skill-upload-zone pdf-upload" + (dragOver ? " pdf-drag-over" : "")}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragOver(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tiff,.bmp,.md,.markdown,.txt,.csv,application/pdf,image/*,text/plain,text/markdown"
          className="skill-file-input"
          onChange={onFilePick}
          aria-hidden
          tabIndex={-1}
        />
        <button
          type="button"
          className="knowledge-upload-btn"
          disabled={disabled || busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? "解析中…" : "浏览文档"}
        </button>
      </div>

      {pendingFile && (
        <div className="pdf-confirm" role="alertdialog" aria-label="云端 OCR 授权">
          <p>
            {pendingFile.name} 将上传云端解析。请确认不含账号、密码或合同隐私。
          </p>
          <div className="pdf-confirm-actions">
            <button
              type="button"
              className="pdf-confirm-cancel"
              onClick={() => setPendingFile(null)}
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              className="pdf-confirm-ok"
              onClick={() => void process(pendingFile, "cloud")}
              disabled={busy}
            >
              确认上传
            </button>
          </div>
        </div>
      )}

      {pendingResult && (
        <div className="pdf-confirm" role="dialog" aria-label="选择去向">
          <p>{pendingResult.file.name} 解析完成，选择去向：</p>
          {pendingResult.text && (
            <p className="skill-install-note">
              正文 {pendingResult.text.length} 字：{pendingResult.text.slice(0, 120)}…
            </p>
          )}
          {pendingResult.rows && (
            <p className="skill-install-note">表格 {pendingResult.rows.length} 行，可写入工作簿。</p>
          )}
          <div className="pdf-confirm-actions">
            <button
              type="button"
              className="pdf-confirm-cancel"
              onClick={cancelLand}
              disabled={busy}
            >
              取消
            </button>
            {pendingResult.text && (
              <button
                type="button"
                className="pdf-confirm-alt"
                onClick={() => void landKnowledge()}
                disabled={busy}
              >
                入知识库
              </button>
            )}
            {pendingResult.rows && (
              <button
                type="button"
                className="pdf-confirm-ok"
                onClick={() => void landSheet()}
                disabled={busy}
              >
                进工作簿
              </button>
            )}
          </div>
        </div>
      )}

      {status && <p className="fetch-ok">{status}</p>}
      {err && <p className="fetch-err">{err}</p>}
      {backend === "cloud" && !pendingFile && !pendingResult && (
        <p className="skill-install-note">云端解析只在确认后才上传；本机 OCR 不上云。</p>
      )}
    </div>
  );
}
