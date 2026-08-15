/** Classify live Excel cells: formulas vs inputs vs errors. No file parsers. */

export const EXCEL_ERROR_RE =
  /^#(DIV\/0!|N\/A|NAME\?|NULL!|NUM!|REF!|VALUE!|GETTING_DATA|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|UNKNOWN!)/i;

export type CellClass = "empty" | "label" | "input" | "formula" | "cross_sheet" | "error";

export type FormulaErrorHit = {
  row: number;
  col: number;
  a1: string;
  formula: string;
  value: string;
};

export type FormulaSample = {
  a1: string;
  kind: "input" | "formula" | "cross_sheet";
  formula: string;
  value: string;
};

export type FormulaSummary = {
  rows: number;
  cols: number;
  empty: number;
  labels: number;
  inputs: number;
  formulas: number;
  crossSheet: number;
  errors: number;
  errorHits: FormulaErrorHit[];
  formulaSample: FormulaSample[];
  inputSample: FormulaSample[];
};

export function isFormulaText(cell: unknown): boolean {
  return typeof cell === "string" && cell.charAt(0) === "=";
}

export function isExcelErrorValue(value: unknown, valueType?: string): boolean {
  if (String(valueType || "").toLowerCase() === "error") return true;
  if (value && typeof value === "object" && "error" in (value as object)) return true;
  const s = String(value ?? "").trim();
  return EXCEL_ERROR_RE.test(s);
}

/** `!` in Excel formulas is a sheet (or book) reference, not a boolean not. */
export function isCrossSheetFormula(formula: string): boolean {
  if (!isFormulaText(formula)) return false;
  return formula.indexOf("!") >= 0;
}

export function isExternalLinkFormula(formula: string): boolean {
  if (!isFormulaText(formula)) return false;
  return /\[[^\]]+\]/.test(formula);
}

export function classifyCell(formula: unknown, value: unknown, valueType?: string): CellClass {
  const f = typeof formula === "string" ? formula : "";
  if (isExcelErrorValue(value, valueType) || (isFormulaText(f) && isExcelErrorValue(f))) {
    return "error";
  }
  if (isFormulaText(f)) {
    return isCrossSheetFormula(f) ? "cross_sheet" : "formula";
  }
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "number" || typeof value === "boolean") return "input";
  const s = String(value).trim();
  if (!s) return "empty";
  if (/^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(s)) return "input";
  return "label";
}

export function indexToCol(col0: number): string {
  let n = Math.max(0, Math.floor(col0)) + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** 1-based start row/col; offsets are 0-based inside the loaded grid. */
export function cellA1(startRow1: number, startCol1: number, rowOffset: number, colOffset: number): string {
  return indexToCol(startCol1 - 1 + colOffset) + String(startRow1 + rowOffset);
}

/**
 * Quote a sheet name for a formula. Names that are not [A-Za-z_][A-Za-z0-9_]*
 * (spaces, CJK, leading digits) must be wrapped in single quotes.
 */
export function quoteSheetName(name: string): string {
  const s = String(name || "").replace(/'/g, "''");
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) return s;
  return "'" + s + "'";
}

export function summarizeGrid(
  formulas: unknown[][],
  values: unknown[][],
  opts?: {
    startRow1?: number;
    startCol1?: number;
    skipHeader?: boolean;
    maxErrors?: number;
    maxSample?: number;
    valueTypes?: unknown[][];
  }
): FormulaSummary {
  const rows = Math.max(formulas.length, values.length);
  const cols = rows === 0 ? 0 : Math.max(formulas[0]?.length || 0, values[0]?.length || 0);
  const startRow1 = opts?.startRow1 || 1;
  const startCol1 = opts?.startCol1 || 1;
  const skipHeader = !!opts?.skipHeader;
  const maxErrors = opts?.maxErrors ?? 40;
  const maxSample = opts?.maxSample ?? 12;
  const types = opts?.valueTypes;
  const out: FormulaSummary = {
    rows,
    cols,
    empty: 0,
    labels: 0,
    inputs: 0,
    formulas: 0,
    crossSheet: 0,
    errors: 0,
    errorHits: [],
    formulaSample: [],
    inputSample: [],
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (skipHeader && r === 0) continue;
      const f = formulas[r] ? formulas[r][c] : "";
      const v = values[r] ? values[r][c] : "";
      const t = types && types[r] ? String(types[r][c] ?? "") : undefined;
      const cls = classifyCell(f, v, t);
      if (cls === "empty") out.empty += 1;
      else if (cls === "label") out.labels += 1;
      else if (cls === "input") out.inputs += 1;
      else if (cls === "formula") out.formulas += 1;
      else if (cls === "cross_sheet") out.crossSheet += 1;
      else out.errors += 1;
      if (cls === "error" && out.errorHits.length < maxErrors) {
        out.errorHits.push({
          row: r,
          col: c,
          a1: cellA1(startRow1, startCol1, r, c),
          formula: isFormulaText(f) ? String(f) : "",
          value: String(v ?? ""),
        });
      }
      if ((cls === "formula" || cls === "cross_sheet") && out.formulaSample.length < maxSample) {
        out.formulaSample.push({
          a1: cellA1(startRow1, startCol1, r, c),
          kind: cls,
          formula: String(f),
          value: String(v ?? ""),
        });
      }
      if (cls === "input" && out.inputSample.length < maxSample) {
        out.inputSample.push({
          a1: cellA1(startRow1, startCol1, r, c),
          kind: "input",
          formula: "",
          value: String(v ?? ""),
        });
      }
    }
  }
  return out;
}

export type ColorRun = {
  row: number;
  startCol: number;
  endCol: number;
  color: string;
};

export const MODEL_COLORS = {
  input: "#0000FF",
  formula: "#000000",
  cross_sheet: "#008000",
  assumptionFill: "#FFFF00",
};

/** Consecutive same-class cells in a row become one Office.js range. */
export function colorRuns(
  classes: CellClass[][],
  colors: { input: string; formula: string; cross_sheet: string } = MODEL_COLORS
): ColorRun[] {
  const runs: ColorRun[] = [];
  for (let r = 0; r < classes.length; r++) {
    const row = classes[r] || [];
    let c = 0;
    while (c < row.length) {
      const cls = row[c];
      const color =
        cls === "input" ? colors.input : cls === "formula" ? colors.formula : cls === "cross_sheet" ? colors.cross_sheet : "";
      if (!color) {
        c += 1;
        continue;
      }
      const start = c;
      c += 1;
      while (c < row.length && row[c] === cls) c += 1;
      runs.push({ row: r, startCol: start, endCol: c - 1, color });
    }
  }
  return runs;
}

export function classifyGrid(
  formulas: unknown[][],
  values: unknown[][],
  opts?: { skipHeader?: boolean; valueTypes?: unknown[][] }
): CellClass[][] {
  const rows = Math.max(formulas.length, values.length);
  const cols = rows === 0 ? 0 : Math.max(formulas[0]?.length || 0, values[0]?.length || 0);
  const grid: CellClass[][] = [];
  for (let r = 0; r < rows; r++) {
    const line: CellClass[] = [];
    for (let c = 0; c < cols; c++) {
      if (opts?.skipHeader && r === 0) {
        line.push("empty");
        continue;
      }
      const f = formulas[r] ? formulas[r][c] : "";
      const v = values[r] ? values[r][c] : "";
      const t = opts?.valueTypes && opts.valueTypes[r] ? String(opts.valueTypes[r][c] ?? "") : undefined;
      line.push(classifyCell(f, v, t));
    }
    grid.push(line);
  }
  return grid;
}
