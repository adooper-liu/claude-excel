/** Pivot field matching and aggregation names. No Office JS. */

export type PivotAgg = "sum" | "count" | "average" | "min" | "max";

export type PivotValue = { field: string; aggregation: PivotAgg };

export type PivotPlan = {
  rows: string[];
  columns: string[];
  values: PivotValue[];
  filters: string[];
};

export function parseAggregation(raw: string | undefined): PivotAgg {
  const s = String(raw || "sum").trim().toLowerCase();
  if (s === "count" || s === "计数") return "count";
  if (s === "average" || s === "avg" || s === "mean" || s === "平均") return "average";
  if (s === "min" || s === "最小") return "min";
  if (s === "max" || s === "最大") return "max";
  return "sum";
}

export function matchField(wanted: string, headers: string[]): string {
  const q = String(wanted || "").trim();
  if (!q) throw new Error("透视字段名为空");
  if (headers.indexOf(q) >= 0) return q;
  const lower = q.toLowerCase();
  const hits = headers.filter((h) => String(h).trim().toLowerCase() === lower);
  if (hits.length === 1) return hits[0];
  const contains = headers.filter((h) => String(h).indexOf(q) >= 0 || q.indexOf(String(h)) >= 0);
  if (contains.length === 1) return contains[0];
  throw new Error('透视字段「' + q + '」不在表头中。现有列: ' + (headers.join("、") || "(无)"));
}

export function planPivot(
  headers: string[],
  opts: {
    rows?: string[];
    columns?: string[];
    values?: Array<{ field: string; aggregation?: string }>;
    filters?: string[];
  }
): PivotPlan {
  const heads = (headers || []).map((h) => String(h || "").trim()).filter(Boolean);
  if (heads.length === 0) throw new Error("没有表头，无法做透视");
  const rows = (opts.rows || []).map((r) => matchField(r, heads));
  const columns = (opts.columns || []).map((c) => matchField(c, heads));
  const rawValues = opts.values || [];
  if (rawValues.length === 0) throw new Error("请指定至少一个值字段，例如金额求和");
  const values = rawValues.map((v) => ({
    field: matchField(v.field, heads),
    aggregation: parseAggregation(v.aggregation),
  }));
  const filters = (opts.filters || []).map((f) => matchField(f, heads));
  if (rows.length === 0 && columns.length === 0) {
    throw new Error("请至少指定一个行字段或列字段");
  }
  return { rows, columns, values, filters };
}

export function uniqueName(base: string, taken: string[]): string {
  const b = String(base || "透视").trim() || "透视";
  if (taken.indexOf(b) < 0) return b;
  let i = 2;
  while (taken.indexOf(b + i) >= 0) i += 1;
  return b + i;
}
