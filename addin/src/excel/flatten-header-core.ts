/** Pure double/multi-row header flatten — no Office JS. */

import { uniqueHeaders } from "./extract-core";
import { resolveIdCell } from "./column-format-core";
import type { Cell } from "./reshape-core";

export interface FlattenHeaderInput {
  grid: Cell[][];
  headerRows?: number;
  separator?: string;
}

export interface FlattenHeaderResult {
  headers: string[];
  rows: Cell[][];
  outputRows: Cell[][];
}

function norm(value: Cell): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

/** Strip brackets/parentheses and dots for stable column names. */
function cleanLabel(value: string): string {
  return String(value || "")
    .replace(/[()（）]/g, "")
    .replace(/\.+/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function fillForward(row: Cell[]): string[] {
  const out: string[] = [];
  let last = "";
  for (let i = 0; i < row.length; i++) {
    const cur = norm(row[i] ?? null);
    if (cur) last = cur;
    out.push(last);
  }
  return out;
}

function childSuffix(parent: string, child: string): string {
  const p = norm(parent);
  const c = norm(child);
  if (!c) return "";
  if (!p || c === p) return "";
  if (c.startsWith(p)) {
    let rest = c.slice(p.length).replace(/^[\s._\-:：]+/, "");
    rest = rest.replace(/^\(/, "").replace(/\)$/, "");
    return cleanLabel(rest);
  }
  return cleanLabel(c);
}

function isStandaloneChildLabel(parent: string, child: string): boolean {
  const c = norm(child);
  const p = norm(parent);
  if (!c || !p || c.startsWith(p)) return false;
  return /[.(（]/.test(c);
}

function combineLabels(parent: string, child: string, separator: string): string {
  const p = cleanLabel(parent);
  const c = norm(child);
  if (!c) return p;
  if (!p || c === p) return flattenChildLabel(c) || p;
  if (c.startsWith(p)) {
    const suffix = childSuffix(parent, c);
    return suffix ? p + separator + suffix : p;
  }
  if (isStandaloneChildLabel(p, c)) return flattenChildLabel(c);
  const flat = flattenChildLabel(c);
  return flat ? p + separator + flat : p;
}

function flattenChildLabel(child: string): string {
  return norm(child)
    .replace(/[()（）]/g, "")
    .replace(/\./g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function padRow(row: Cell[], width: number): Cell[] {
  const next = row.slice();
  while (next.length < width) next.push("");
  return next;
}

export function flattenHeaderRows(headerGrid: Cell[][], separator: string): string[] {
  if (!headerGrid.length) return [];
  const width = headerGrid.reduce(function (m, row) {
    return Math.max(m, row.length);
  }, 0);
  if (width <= 0) return [];

  const filled = headerGrid.map(function (row) {
    return fillForward(padRow(row, width));
  });

  if (filled.length === 1) {
    return uniqueHeaders(
      filled[0].map(function (h, i) {
        return cleanLabel(h) || "列" + (i + 1);
      })
    );
  }

  const parents = filled[0];
  const headers: string[] = [];
  for (let col = 0; col < width; col++) {
    let name = cleanLabel(parents[col]);
    for (let r = 1; r < filled.length; r++) {
      const part = norm(headerGrid[r][col] ?? null);
      if (!part) continue;
      name = combineLabels(name || cleanLabel(filled[r][col]), part, separator);
    }
    headers.push(name || "列" + (col + 1));
  }
  return uniqueHeaders(headers);
}

export function flattenHeader(input: FlattenHeaderInput): FlattenHeaderResult {
  const grid = input.grid || [];
  if (!grid.length) throw new Error("拍平表头需要非空区域。");

  const headerRows = Math.max(1, Math.floor(Number(input.headerRows) || 2));
  if (grid.length <= headerRows) {
    throw new Error("区域行数（" + grid.length + "）必须大于表头行数（" + headerRows + "）。");
  }

  const separator = input.separator == null || input.separator === "" ? "_" : String(input.separator);
  const headerGrid = grid.slice(0, headerRows);
  const headers = flattenHeaderRows(headerGrid, separator);
  const width = headers.length;
  const rows = grid.slice(headerRows).map(function (row) {
    return padRow(row, width);
  });

  return {
    headers: headers,
    rows: rows,
    outputRows: [headers.slice() as Cell[]].concat(rows),
  };
}

/**
 * 拍平写入时保真：仅 id 文本列（单号/运单等）用显示文本防科学计数法，
 * 其余列**原样透传**（不改值、不按列格式推断转日期/金额）。flatten_header 是结构性操作。
 */
export function preserveRowForFlatten(
  row: Cell[],
  textCols: number[],
  textRow?: string[]
): Cell[] {
  const next = row.slice();
  if (textCols && textCols.length) {
    textCols.forEach(function (col) {
      next[col] = resolveIdCell(next[col] ?? null, textRow ? textRow[col] || "" : "");
    });
  }
  return next;
}
