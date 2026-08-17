/** Pure reshape logic — no Office JS. Always returns a new grid; never mutates input. */

import { columnKeyToIndex } from "./filter-core";
import { indexToCol } from "./formula-inspect-core";

export type Cell = string | number | boolean | null;
export type ReshapeOp = "dedupe" | "unpivot" | "split" | "coerce" | "project" | "flatten_header";
export type CoerceType = "number" | "text" | "date";

export interface ProjectColumnSpec {
  as: string;
  from?: string | number;
  merge?: (string | number)[];
  separator?: string;
  coerce?: CoerceType;
}

export interface ReshapeInput {
  headers: string[];
  rows: Cell[][];
  op: ReshapeOp;
  keys?: string[];
  idColumns?: string[];
  valueColumns?: string[];
  attributeName?: string;
  valueName?: string;
  column?: string;
  separator?: string;
  maxParts?: number;
  type?: CoerceType;
  headerless?: boolean;
  columns?: ProjectColumnSpec[];
}

export interface ReshapeResult {
  headers: string[];
  rows: Cell[][];
  outputRows: Cell[][];
  dropped?: number;
  converted?: number;
  blanked?: number;
}

function norm(value: Cell): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function requireColumn(headers: string[], name: string): void {
  if (headers.indexOf(name) < 0) {
    throw new Error("没有列「" + name + "」。现有列: " + headers.join("、"));
  }
}

/** Dedupe one block against a running `seen` set. Does not keep prior rows in memory. */
export function dedupeChunk(
  headers: string[],
  rows: Cell[][],
  keys: string[],
  seen: Set<string>
): { kept: Cell[][]; dropped: number } {
  const useKeys = keys && keys.length ? keys : headers;
  useKeys.forEach(function (k) {
    requireColumn(headers, k);
  });
  const idxs = useKeys.map(function (k) {
    return headers.indexOf(k);
  });
  const kept: Cell[][] = [];
  let dropped = 0;
  (rows || []).forEach(function (row) {
    const key = idxs
      .map(function (i) {
        return norm(row[i] ?? null);
      })
      .join("\x1f");
    if (seen.has(key)) {
      dropped += 1;
      return;
    }
    seen.add(key);
    kept.push(row.slice());
  });
  return { kept: kept, dropped: dropped };
}

function toObjects(headers: string[], rows: Cell[][]): Record<string, Cell>[] {
  return rows.map(function (cells) {
    const obj: Record<string, Cell> = {};
    headers.forEach(function (h, i) {
      obj[h] = cells[i] ?? null;
    });
    return obj;
  });
}

function pack(headers: string[], rows: Cell[][], extra?: Partial<ReshapeResult>): ReshapeResult {
  const outputRows: Cell[][] = [headers.slice(), ...rows];
  return Object.assign({ headers: headers, rows: rows, outputRows: outputRows }, extra || {});
}

function dedupe(input: ReshapeInput): ReshapeResult {
  const keys = input.keys && input.keys.length ? input.keys : input.headers;
  const seen = new Set<string>();
  const part = dedupeChunk(input.headers, input.rows, keys, seen);
  return pack(input.headers, part.kept, { dropped: part.dropped });
}

function unpivot(input: ReshapeInput): ReshapeResult {
  const idColumns =
    input.idColumns && input.idColumns.length ? input.idColumns : input.headers.slice(0, 1);
  idColumns.forEach(function (c) {
    requireColumn(input.headers, c);
  });
  const valueColumns =
    input.valueColumns && input.valueColumns.length
      ? input.valueColumns
      : input.headers.filter(function (h) {
          return idColumns.indexOf(h) < 0;
        });
  valueColumns.forEach(function (c) {
    requireColumn(input.headers, c);
  });
  const attr = input.attributeName || "属性";
  const val = input.valueName || "值";
  const headers = idColumns.concat([attr, val]);
  const objs = toObjects(input.headers, input.rows);
  const rows: Cell[][] = [];
  objs.forEach(function (row) {
    valueColumns.forEach(function (vc) {
      rows.push(
        idColumns
          .map(function (c) {
            return row[c] ?? null;
          })
          .concat([vc, row[vc] ?? null])
      );
    });
  });
  return pack(headers, rows);
}

function splitColumn(input: ReshapeInput): ReshapeResult {
  const column = input.column;
  if (!column) throw new Error("拆列需要 column");
  requireColumn(input.headers, column);
  const sep = input.separator == null || input.separator === "" ? "," : input.separator;
  const colIdx = input.headers.indexOf(column);
  let maxParts = input.maxParts || 0;
  if (maxParts <= 0) {
    input.rows.forEach(function (row) {
      const n = norm(row[colIdx] ?? null).split(sep).length;
      if (n > maxParts) maxParts = n;
    });
    if (maxParts < 1) maxParts = 1;
  }
  const partHeaders: string[] = [];
  for (let i = 1; i <= maxParts; i++) partHeaders.push(column + "_" + i);
  const headers = input.headers
    .filter(function (h) {
      return h !== column;
    })
    .concat(partHeaders);
  const rows = input.rows.map(function (row) {
    const parts = norm(row[colIdx] ?? null).split(sep);
    const filled: Cell[] = [];
    for (let i = 0; i < maxParts; i++) {
      filled.push(i < parts.length ? parts[i].trim() : "");
    }
    const rest = input.headers
      .map(function (h, i) {
        return h === column ? null : row[i] ?? null;
      })
      .filter(function (_v, i) {
        return input.headers[i] !== column;
      });
    return rest.concat(filled);
  });
  return pack(headers, rows);
}

function coerceNumber(value: Cell): { value: Cell; kind: "same" | "converted" | "blanked" } {
  if (value === null || value === undefined || value === "") {
    return { value: null, kind: "same" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value: value, kind: "same" };
  }
  const s = String(value).trim().replace(/,/g, "");
  if (s === "") return { value: null, kind: "blanked" };
  const n = Number(s);
  if (Number.isFinite(n)) return { value: n, kind: "converted" };
  return { value: null, kind: "blanked" };
}

function pad2(n: string): string {
  return n.length === 1 ? "0" + n : n;
}

function coerceDate(value: Cell): { value: Cell; kind: "same" | "converted" | "blanked" } {
  if (value === null || value === undefined || value === "") {
    return { value: null, kind: "same" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value: value, kind: "same" };
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return { value: m[1] + "-" + pad2(m[2]) + "-" + pad2(m[3]), kind: "converted" };
  return { value: null, kind: "blanked" };
}

function coerceText(value: Cell): Cell {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function coerce(input: ReshapeInput): ReshapeResult {
  const column = input.column;
  if (!column) throw new Error("类型强制需要 column");
  requireColumn(input.headers, column);
  const kind = input.type || "number";
  const idx = input.headers.indexOf(column);
  let converted = 0;
  let blanked = 0;
  const rows = input.rows.map(function (row) {
    const next = row.slice();
    const cur = next[idx] ?? null;
    if (kind === "text") {
      next[idx] = coerceText(cur);
      return next;
    }
    const r = kind === "date" ? coerceDate(cur) : coerceNumber(cur);
    if (r.kind === "converted") converted += 1;
    if (r.kind === "blanked") blanked += 1;
    next[idx] = r.value;
    return next;
  });
  return pack(input.headers, rows, { converted: converted, blanked: blanked });
}

function resolveColRef(ref: string | number, headers: string[], rowWidth: number): number {
  if (typeof ref === "number") {
    const i = Math.floor(ref);
    if (i < 0 || i >= rowWidth) {
      throw new Error("列索引 " + i + " 超出范围（0.." + (rowWidth - 1) + "）");
    }
    return i;
  }
  return columnKeyToIndex(String(ref), headers, 0);
}

function syntheticHeaders(width: number): string[] {
  const headers: string[] = [];
  for (let i = 0; i < width; i++) headers.push(indexToCol(i));
  return headers;
}

function padRow(row: Cell[], width: number): Cell[] {
  const next = row.slice();
  while (next.length < width) next.push("");
  return next;
}

function applyProjectCoerce(value: Cell, kind?: CoerceType): { value: Cell; converted: number; blanked: number } {
  if (!kind || kind === "text") {
    return { value: kind === "text" ? coerceText(value) : value, converted: 0, blanked: 0 };
  }
  const r = kind === "date" ? coerceDate(value) : coerceNumber(value);
  return {
    value: r.value,
    converted: r.kind === "converted" ? 1 : 0,
    blanked: r.kind === "blanked" ? 1 : 0,
  };
}

function projectCellValue(
  row: Cell[],
  spec: ProjectColumnSpec,
  headers: string[]
): { value: Cell; converted: number; blanked: number } {
  let raw: Cell;
  if (spec.merge && spec.merge.length) {
    const sep = spec.separator == null ? "" : spec.separator;
    const parts = spec.merge.map(function (ref) {
      const idx = resolveColRef(ref, headers, row.length);
      return norm(row[idx] ?? null);
    });
    raw = parts.join(sep);
  } else if (spec.from != null) {
    const idx = resolveColRef(spec.from, headers, row.length);
    raw = row[idx] ?? null;
  } else {
    raw = "";
  }
  return applyProjectCoerce(raw, spec.coerce);
}

function project(input: ReshapeInput): ReshapeResult {
  const specs = input.columns;
  if (!specs || !specs.length) throw new Error("project 需要 columns");
  specs.forEach(function (spec, i) {
    if (!spec || !String(spec.as || "").trim()) {
      throw new Error("project.columns[" + i + "] 需要 as（输出列名）");
    }
    if (spec.merge && spec.merge.length) return;
    if (spec.from == null) throw new Error("project.columns[" + i + "] 需要 from 或 merge");
  });

  let headers = input.headers.slice();
  let rows = input.rows.map(function (r) {
    return r.slice();
  });
  if (input.headerless) {
    rows = [headers as Cell[]].concat(rows);
  }

  const width = Math.max(
    headers.length,
    rows.reduce(function (m, r) {
      return Math.max(m, r.length);
    }, 0)
  );
  if (input.headerless) {
    headers = syntheticHeaders(width);
  }

  const outHeaders = specs.map(function (s) {
    return String(s.as).trim();
  });
  let converted = 0;
  let blanked = 0;
  const outRows = rows.map(function (row) {
    const padded = padRow(row, width);
    return specs.map(function (spec) {
      const hit = projectCellValue(padded, spec, headers);
      converted += hit.converted;
      blanked += hit.blanked;
      return hit.value;
    });
  });

  return pack(outHeaders, outRows, { converted: converted, blanked: blanked });
}

export function reshape(input: ReshapeInput): ReshapeResult {
  if (input.op === "dedupe") return dedupe(input);
  if (input.op === "unpivot") return unpivot(input);
  if (input.op === "split") return splitColumn(input);
  if (input.op === "coerce") return coerce(input);
  if (input.op === "project") return project(input);
  throw new Error("Unknown reshape op");
}
