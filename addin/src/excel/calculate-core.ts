/** Pure calculate logic — emit live Excel formulas, never precomputed aggregates. */

export type Cell = string | number | boolean | null;
export type CalculateOp = "lookup" | "sumifs" | "fix_ref";

export interface CalculateInput {
  op: CalculateOp;
  leftTable?: string;
  rightTable?: string;
  leftHeaders?: string[];
  leftRows?: Cell[][];
  rightHeaders?: string[];
  key?: string;
  bringColumns?: string[];
  tableName?: string;
  headers?: string[];
  rows?: Cell[][];
  groupBy?: string;
  valueColumn?: string;
  /** When set, SUMIFS uses sheet!col refs (Office.js-safe) instead of cross-table structured refs. */
  sourceSheet?: string;
}

export interface CalculateResult {
  headers: string[];
  rows: Cell[][];
  outputRows: Cell[][];
}

function requireColumn(headers: string[], name: string, where: string): void {
  if (headers.indexOf(name) < 0) {
    throw new Error(where + "没有列「" + name + "」。现有列: " + headers.join("、"));
  }
}

function pack(headers: string[], rows: Cell[][]): CalculateResult {
  const outputRows: Cell[][] = [headers.slice(), ...rows];
  return { headers: headers, rows: rows, outputRows: outputRows };
}

function isSimpleColumn(column: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(column);
}

function isSimpleTableName(table: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(table);
}

export function tableRefName(table: string): string {
  const name = String(table || "").trim();
  if (!name) return "Table";
  return isSimpleTableName(name) ? name : "'" + name.replace(/'/g, "''") + "'";
}

export function quoteColumn(column: string): string {
  return isSimpleColumn(column) ? column : "[" + column + "]";
}

export function structCol(table: string, column: string): string {
  return tableRefName(table) + "[" + quoteColumn(column) + "]";
}

export function thisRowCol(column: string): string {
  return isSimpleColumn(column) ? "[@" + column + "]" : "[@[" + column + "]]";
}

export function lookupFormula(keyCol: string, rightTable: string, bringCol: string): string {
  return (
    "=IFERROR(INDEX(" +
    structCol(rightTable, bringCol) +
    ",MATCH(" +
    thisRowCol(keyCol) +
    "," +
    structCol(rightTable, keyCol) +
    ',0)),"")'
  );
}

export function sumifsFormula(table: string, valueCol: string, groupCol: string): string {
  return (
    "=SUMIFS(" +
    structCol(table, valueCol) +
    "," +
    structCol(table, groupCol) +
    "," +
    thisRowCol(groupCol) +
    ")"
  );
}

export function colIndexToLetter(index: number): string {
  let n = Math.max(0, Number(index) || 0) + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

export function quoteSheetName(sheet: string): string {
  const name = String(sheet || "").trim();
  if (!name) return "''";
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name)) return name;
  return "'" + name.replace(/'/g, "''") + "'";
}

/** Per-row A1 criteria (A2, A3, …) — avoids Office.js failures on cross-table structured refs. */
export function sumifsFormulaSheet(
  sourceSheet: string,
  valueColLetter: string,
  groupColLetter: string,
  criteriaA1: string
): string {
  const sheetRef = quoteSheetName(sourceSheet);
  const valueRange = sheetRef + "!" + valueColLetter + ":" + valueColLetter;
  const groupRange = sheetRef + "!" + groupColLetter + ":" + groupColLetter;
  return "=SUMIFS(" + valueRange + "," + groupRange + "," + criteriaA1 + ")";
}

export function fixRefFormula(formula: string): string {
  let s = String(formula || "");
  s = s.replace(/,\s*#REF!/gi, "");
  s = s.replace(/#REF!\s*,/gi, "");
  s = s.replace(/#REF!/gi, "0");
  return s;
}

function lookup(input: CalculateInput): CalculateResult {
  const leftHeaders = input.leftHeaders || [];
  const rightHeaders = input.rightHeaders || [];
  const key = input.key || "";
  const bring = input.bringColumns || [];
  const leftTable = input.leftTable || "";
  const rightTable = input.rightTable || "";
  if (!leftTable || !rightTable || !key || !bring.length) {
    throw new Error("lookup 需要 leftTable、rightTable、key、bringColumns");
  }
  requireColumn(leftHeaders, key, "左表");
  requireColumn(rightHeaders, key, "右表");
  bring.forEach(function (c) {
    requireColumn(rightHeaders, c, "右表");
  });
  const headers = leftHeaders.slice();
  const outBring: string[] = [];
  bring.forEach(function (c) {
    outBring.push(headers.indexOf(c) >= 0 ? c + "_lookup" : c);
    headers.push(outBring[outBring.length - 1]);
  });
  const rows = (input.leftRows || []).map(function (row) {
    const next: Cell[] = row.slice();
    bring.forEach(function (c) {
      next.push(lookupFormula(key, rightTable, c));
    });
    return next;
  });
  return pack(headers, rows);
}

function sumifs(input: CalculateInput): CalculateResult {
  const headersIn = input.headers || [];
  const tableName = input.tableName || "";
  const groupBy = input.groupBy || "";
  const valueColumn = input.valueColumn || "";
  const sourceSheet = String(input.sourceSheet || "").trim();
  if (!tableName || !groupBy || !valueColumn) {
    throw new Error("sumifs 需要 tableName、groupBy、valueColumn");
  }
  requireColumn(headersIn, groupBy, "表");
  requireColumn(headersIn, valueColumn, "表");
  const gIdx = headersIn.indexOf(groupBy);
  const vIdx = headersIn.indexOf(valueColumn);
  const seen = new Set<string>();
  const groups: Cell[] = [];
  (input.rows || []).forEach(function (row) {
    const g = row[gIdx];
    const key = g === null || g === undefined ? "" : String(g).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    groups.push(g);
  });
  const rows = groups.map(function (g, i) {
    let formula: string;
    if (sourceSheet) {
      const rowNum = i + 2;
      formula = sumifsFormulaSheet(
        sourceSheet,
        colIndexToLetter(vIdx),
        colIndexToLetter(gIdx),
        "A" + rowNum
      );
    } else {
      formula = sumifsFormula(tableName, valueColumn, groupBy);
    }
    return [g, formula];
  });
  return pack([groupBy, "合计"], rows);
}

export function calculate(input: CalculateInput): CalculateResult {
  if (input.op === "lookup") return lookup(input);
  if (input.op === "sumifs") return sumifs(input);
  throw new Error("Unknown calculate op");
}
