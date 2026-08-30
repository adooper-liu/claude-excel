/**
 * DocRecipeBar — document-recognition templates (doc-recipe).
 * User-authored field dictionaries + format rules used when extracting a
 * document. P0: list / create / rename / delete via a text editor.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../services/api-config";

export type DocRecipeSummary = {
  name: string;
  description?: string;
  fieldCount: number;
  updatedAt?: string;
  sample?: string;
};

export type DocRecipeField = {
  name: string;
  type: string;
  source?: string;
  format?: Record<string, unknown>;
  group?: string;
};

export type DocRecipeProposal = {
  name: string;
  description?: string;
  fields: DocRecipeField[];
};

interface Props {
  disabled: boolean;
  onChanged?: () => void;
  draft?: DocRecipeProposal | null;
}

const FIELD_TYPES = ["text", "number", "date", "amount", "percent"];

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
    throw new Error(String((data as { detail?: string }).detail || r.statusText || "请求失败"));
  }
  return data;
}

function parseFieldsText(text: string): DocRecipeField[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("字段 JSON 必须是数组");
    }
    return parsed.map(function (item, i) {
      const f = item as { name?: unknown; type?: unknown; source?: unknown; format?: unknown; group?: unknown };
      if (!f || typeof f !== "object" || !f.name) {
        throw new Error("第 " + (i + 1) + " 个字段缺少 name");
      }
      const type = String(f.type || "text").toLowerCase();
      const field: DocRecipeField = {
        name: String(f.name),
        type: FIELD_TYPES.indexOf(type) >= 0 ? type : "text",
      };
      if (f.source) field.source = String(f.source);
      if (f.format && typeof f.format === "object") {
        field.format = f.format as Record<string, unknown>;
      }
      if (f.group === "header" || f.group === "detail") {
        field.group = String(f.group);
      }
      return field;
    });
  }
  return trimmed
    .split("\n")
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean)
    .map(function (line) {
      const sep = /[:：]/;
      const first = line.search(sep);
      let name = line;
      let type = "text";
      let source = "";
      if (first >= 0) {
        name = line.slice(0, first).trim();
        const rest = line.slice(first + 1);
        const second = rest.search(sep);
        if (second >= 0) {
          type = rest.slice(0, second).trim();
          source = rest.slice(second + 1).trim();
        } else {
          type = rest.trim();
        }
      }
      const field: DocRecipeField = {
        name: name,
        type: FIELD_TYPES.indexOf(type) >= 0 ? type : "text",
      };
      if (source) field.source = source;
      return field;
    });
}

function fieldsToText(fields: DocRecipeField[]): string {
  // The line format (字段名:类型:来源) cannot represent a name or source that
  // contains a colon, so fall back to JSON to keep the round-trip lossless.
  const needsJson = fields.some(function (f) {
    const hasFormat = f.format && Object.keys(f.format).length > 0;
    const hasColon = /[:：]/.test(f.name) || (f.source ? /[:：]/.test(f.source) : false);
    const hasGroup = f.group === "header" || f.group === "detail";
    return hasFormat || hasColon || hasGroup;
  });
  if (needsJson) {
    return JSON.stringify(fields);
  }
  return fields
    .map(function (f) {
      const type = FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : "text";
      return f.source ? f.name + ":" + type + ":" + f.source : f.name + ":" + type;
    })
    .join("\n");
}

export default function DocRecipeBar({ disabled, onChanged, draft }: Props): JSX.Element {
  const [recipes, setRecipes] = useState<DocRecipeSummary[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fieldsText, setFieldsText] = useState("");
  const [sampleFile, setSampleFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState("");
  const sampleRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getJson("/api/doc-recipes");
      setRecipes((data.recipes as DocRecipeSummary[]) || []);
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(function () {
    void refresh();
  }, [refresh]);

  const openCreate = useCallback(() => {
    setOriginalName("");
    setName("");
    setDescription("");
    setFieldsText("");
    setSampleFile(null);
    if (sampleRef.current) sampleRef.current.value = "";
    setErr("");
    setFormOpen(true);
  }, []);

  // A draft (auto-generated template from an OCR result) opens the create
  // form pre-filled; the user can still rename/edit fields before saving.
  useEffect(
    function () {
      if (!draft) return;
      setOriginalName("");
      setName(draft.name || "");
      setDescription(draft.description || "");
      setFieldsText(fieldsToText(Array.isArray(draft.fields) ? draft.fields : []));
      setSampleFile(null);
      if (sampleRef.current) sampleRef.current.value = "";
      setErr("");
      setFormOpen(true);
    },
    [draft]
  );

  const openEdit = useCallback(
    (r: DocRecipeSummary) => {
      setOriginalName(r.name);
      setName(r.name);
      setDescription(r.description || "");
      setFieldsText("");
      setSampleFile(null);
      if (sampleRef.current) sampleRef.current.value = "";
      setErr("");
      setFormOpen(true);
      void (async () => {
        try {
          const data = await getJson("/api/doc-recipes/" + encodeURIComponent(r.name));
          const fields = (data as { fields?: DocRecipeField[] }).fields || [];
          setFieldsText(fieldsToText(fields));
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    []
  );

  const save = useCallback(async () => {
    if (saving || disabled) return;
    const templateName = name.trim();
    if (!templateName) {
      setErr("请填写模板名");
      return;
    }
    let fields: DocRecipeField[];
    try {
      fields = parseFieldsText(fieldsText);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }
    if (!fields.length) {
      setErr("请至少填写一个字段（每行：字段名:类型:来源，或粘贴 JSON 数组）");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const form = new FormData();
      form.append(
        "template",
        JSON.stringify({ name: templateName, description: description.trim(), fields: fields })
      );
      if (originalName) form.append("originalName", originalName);
      if (sampleFile) form.append("sample", sampleFile, sampleFile.name);
      const r = await fetch(API_BASE + "/api/doc-recipes", { method: "POST", body: form });
      const data = await readJson(r);
      if (!r.ok) {
        throw new Error(String((data as { detail?: string }).detail || r.statusText || "保存失败"));
      }
      setFormOpen(false);
      setOriginalName("");
      if (sampleRef.current) sampleRef.current.value = "";
      setSampleFile(null);
      await refresh();
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [saving, disabled, name, description, fieldsText, originalName, sampleFile, refresh, onChanged]);

  const remove = useCallback(
    async (templateName: string) => {
      if (disabled || busy) return;
      if (confirmDelete !== templateName) {
        setConfirmDelete(templateName);
        window.setTimeout(function () {
          setConfirmDelete(function (current) {
            return current === templateName ? "" : current;
          });
        }, 3000);
        return;
      }
      setConfirmDelete("");
      setBusy(true);
      setErr("");
      try {
        const r = await fetch(API_BASE + "/api/doc-recipes/" + encodeURIComponent(templateName), {
          method: "DELETE",
        });
        const data = await readJson(r);
        if (!r.ok) {
          throw new Error(String((data as { detail?: string }).detail || r.statusText || "删除失败"));
        }
        if (originalName === templateName) {
          setFormOpen(false);
          setOriginalName("");
        }
        await refresh();
        onChanged?.();
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [disabled, busy, originalName, confirmDelete, refresh, onChanged]
  );

  return (
    <div className="fetch-bar doc-recipe-bar">
      <div className="fetch-row doc-recipe-head">
        <span className="knowledge-title">识别模板</span>
        <button type="button" className="knowledge-upload-btn" disabled={disabled || busy} onClick={openCreate}>
          + 新建
        </button>
      </div>
      {recipes.length > 0 && (
        <ul className="knowledge-doc-list">
          {recipes.map(function (r) {
            return (
              <li key={r.name}>
                <span className="knowledge-doc-name" title={r.name}>
                  {r.name}
                  {r.sample ? " · 样例" : ""}
                </span>
                <span className="knowledge-doc-meta">
                  {r.fieldCount} 字段{r.updatedAt ? " · " + String(r.updatedAt).slice(0, 10) : ""}
                </span>
                <button
                  type="button"
                  className="doc-recipe-edit"
                  disabled={disabled || busy}
                  aria-label={"编辑 " + r.name}
                  onClick={() => openEdit(r)}
                >
                  改
                </button>
                <button
                  type="button"
                  className={"prompt-del" + (confirmDelete === r.name ? " doc-recipe-del-confirm" : "")}
                  disabled={disabled || busy}
                  aria-label={confirmDelete === r.name ? "确认删除 " + r.name : "删除 " + r.name}
                  onClick={() => void remove(r.name)}
                >
                  {confirmDelete === r.name ? "确认？" : "✕"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!recipes.length && !err && (
        <p className="skill-install-note">
          还没有识别模板。新建一个：填字段名/类型/来源，上传文档时选它自动清洗。
        </p>
      )}
      {formOpen && (
        <div className="doc-recipe-form">
          <input
            className="knowledge-path-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="模板名（唯一）"
            aria-label="模板名"
            disabled={saving}
          />
          <input
            className="knowledge-path-input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="说明（可选）"
            aria-label="模板说明"
            disabled={saving}
          />
          <textarea
            className="doc-recipe-fields"
            rows={5}
            value={fieldsText}
            onChange={(e) => setFieldsText(e.target.value)}
            placeholder={"字段字典，每行：字段名:类型:来源\n类型：text / number / date / amount / percent\n或直接粘贴 JSON 数组"}
            aria-label="字段字典"
            disabled={saving}
          />
          <div className="doc-recipe-form-actions">
            <input
              ref={sampleRef}
              type="file"
              accept=".png,.jpg,.jpeg,.tif,.tiff,.bmp,.pdf,image/*,application/pdf"
              className="skill-file-input"
              onChange={(e) => setSampleFile(e.target.files?.[0] || null)}
              aria-label="参考样例"
            />
            <button
              type="button"
              className="knowledge-upload-btn"
              disabled={saving}
              onClick={() => sampleRef.current?.click()}
            >
              {sampleFile ? "样例：已选" : "上传样例"}
            </button>
            <button
              type="button"
              className="pdf-confirm-cancel"
              disabled={saving}
              onClick={() => {
                setFormOpen(false);
                setOriginalName("");
                setSampleFile(null);
                setErr("");
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="pdf-confirm-ok"
              disabled={saving || !name.trim()}
              onClick={() => void save()}
            >
              {saving ? "保存中…" : originalName ? "保存改动" : "创建"}
            </button>
          </div>
          <p className="skill-install-note">
            样例只存不解析（P0）。number 字段按 numberStyle 归一化千分位/小数点。
          </p>
        </div>
      )}
      {err && <p className="fetch-err">{err}</p>}
    </div>
  );
}