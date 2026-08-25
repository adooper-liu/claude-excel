import type { ProjectColumnSpec } from "./reshape-core";
import { API_BASE } from "../services/api-config";

export interface RecipeProjectHit {
  columns: ProjectColumnSpec[];
  headerless: boolean;
  source: "recipe";
  targets?: string[];
}

function normalizeFrom(raw: unknown): string | number | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "number") return raw;
  const s = String(raw);
  if (/^\d+$/.test(s)) return Number(s);
  return s;
}

/** `__` 前缀列是行级审计列（如对账结果的 __match_mode），默认不映射到下游；要带走须显式 columns[].from 声明。 */
function isReservedAuditColumn(name: string): boolean {
  return name.startsWith("__");
}

export function normalizeColumns(raw: unknown[]): ProjectColumnSpec[] {
  const out: ProjectColumnSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const as = String(c.as || "").trim();
    if (!as || isReservedAuditColumn(as)) continue;
    const spec: ProjectColumnSpec = { as };
    if (Array.isArray(c.merge) && c.merge.length) {
      spec.merge = c.merge.map(function (m) {
        return Number(m);
      });
    } else {
      const from = normalizeFrom(c.from);
      if (from == null) continue;
      if (typeof from === "string" && isReservedAuditColumn(from)) continue;
      spec.from = from;
    }
    if (c.separator != null) spec.separator = String(c.separator);
    if (c.coerce === "number" || c.coerce === "text" || c.coerce === "date") {
      spec.coerce = c.coerce;
    }
    out.push(spec);
  }
  return out;
}

/** Load host / import-sheet project mapping from backend templates. */
export async function fetchRecipeProject(opts: {
  url?: string;
  sheetName?: string;
  targets?: string[];
}): Promise<RecipeProjectHit | null> {
  const params = new URLSearchParams();
  if (opts.url) params.set("url", opts.url);
  if (opts.sheetName) params.set("sheet", opts.sheetName);
  if (opts.targets && opts.targets.length) params.set("targets", opts.targets.join("/"));
  try {
    const r = await fetch(API_BASE + "/api/fetch-recipe/project?" + params.toString());
    if (!r.ok) return null;
    const data = (await r.json()) as {
      project?: { columns?: unknown[]; headerless?: boolean } | null;
      targets?: string[];
    };
    const cols = data && data.project && Array.isArray(data.project.columns) ? data.project.columns : [];
    const columns = normalizeColumns(cols);
    if (columns.length < 3) return null;
    return {
      columns,
      headerless: !!(data.project && data.project.headerless),
      source: "recipe",
      targets: Array.isArray(data.targets) ? data.targets : undefined,
    };
  } catch {
    return null;
  }
}

/** Default target column names when user did not list them in the message. */
export async function fetchRecipeTargets(sheetName: string): Promise<string[]> {
  const params = new URLSearchParams();
  params.set("sheet", sheetName);
  try {
    const r = await fetch(API_BASE + "/api/fetch-recipe/project?" + params.toString());
    if (!r.ok) return [];
    const data = (await r.json()) as { targets?: string[] };
    return Array.isArray(data.targets) ? data.targets.filter(Boolean) : [];
  } catch {
    return [];
  }
}
