/** Pure extract/normalize logic — no Office JS. */

export type CaseMode = "lower" | "upper" | "title" | "keep";

export interface ExtractInput {
  headers: string[];
  rows: unknown[][];
  caseMode?: CaseMode;
  unique?: boolean;
}

export interface ExtractResult {
  headers: string[];
  rows: string[][];
  outputRows: string[][];
  sourceRows: number;
  blankDropped: number;
  uniqueDropped: number;
}

export function normalizeCell(value: unknown, caseMode: CaseMode = "title"): string {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  if (caseMode === "keep") return s;
  if (caseMode === "lower") return s.toLowerCase();
  if (caseMode === "upper") return s.toUpperCase();
  return s.replace(/[A-Za-z]+/g, function (word) {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

export function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map(function (raw, i) {
    const base = String(raw || "").trim() || "列" + (i + 1);
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : base + "_" + n;
  });
}

export function extractChunk(
  rows: unknown[][],
  colCount: number,
  caseMode: CaseMode,
  unique: boolean,
  seen: Set<string> | null
): { rows: string[][]; blankDropped: number; uniqueDropped: number } {
  const cols = Math.max(1, colCount);
  const kept: string[][] = [];
  let blankDropped = 0;
  let uniqueDropped = 0;
  (rows || []).forEach(function (row) {
    const cells: string[] = [];
    for (let i = 0; i < cols; i++) {
      cells.push(normalizeCell(row && row[i], caseMode));
    }
    if (
      cells.every(function (c) {
        return c === "";
      })
    ) {
      blankDropped += 1;
      return;
    }
    if (unique && seen) {
      const key = cells.join("\x1f");
      if (seen.has(key)) {
        uniqueDropped += 1;
        return;
      }
      seen.add(key);
    }
    kept.push(cells);
  });
  return { rows: kept, blankDropped: blankDropped, uniqueDropped: uniqueDropped };
}

/** Trim, collapse spaces, unify Latin case. Drop blank rows. Optionally keep first unique row. */
export function extractColumn(input: ExtractInput): ExtractResult {
  const caseMode: CaseMode = input.caseMode || "title";
  const headers = uniqueHeaders(input.headers && input.headers.length ? input.headers : ["值"]);
  const seen = input.unique ? new Set<string>() : null;
  const part = extractChunk(input.rows, headers.length, caseMode, !!input.unique, seen);
  return {
    headers: headers,
    rows: part.rows,
    outputRows: [headers.slice()].concat(part.rows),
    sourceRows: input.rows.length,
    blankDropped: part.blankDropped,
    uniqueDropped: part.uniqueDropped,
  };
}
