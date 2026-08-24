/** Pure calculate logic — emit live Excel formulas, never precomputed aggregates. */

export type Cell = string | number | boolean | null;
export type CalculateOp =
  | "lookup"
  | "sumifs"
  | "sumifs_multi"
  | "fix_ref"
  | "arithmetic"
  | "conditional_column";

export type SumifsCriterion = {
  column: string;
  /** Literal criteria (fixed filter). */
  value?: string | number;
};

export type ArithOp = "+" | "-" | "*" | "/";

export type ArithTerm = {
  /** Ignored on the first term; default "+" thereafter. */
  op?: ArithOp;
  column?: string;
  literal?: number;
  /** Absolute sheet cell, e.g. 假设参数!B3 */
  sheetCell?: string;
};

export type CondOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "between";

export type CondExpr = {
  column?: string;
  literal?: string | number | boolean;
};

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
  /** One column, or multiple for composite unique groups. */
  groupBy?: string | string[];
  valueColumn?: string;
  /** Extra fixed SUMIFS criteria (literal values). */
  criteria?: SumifsCriterion[];
  /** When set, SUMIFS uses sheet!col refs instead of structured refs. */
  sourceSheet?: string;
  outputColumn?: string;
  expression?: { terms: ArithTerm[] };
  column?: string;
  operator?: CondOperator;
  value?: string | number;
  valueTo?: string | number;
  trueExpr?: CondExpr;
  falseExpr?: CondExpr;
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

export function excelCriteriaLiteral(value: string | number | boolean): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const s = String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

export function normalizeGroupBy(groupBy: string | string[] | undefined): string[] {
  if (Array.isArray(groupBy)) {
    return groupBy.map((s) => String(s || "").trim()).filter(Boolean);
  }
  const raw = String(groupBy || "").trim();
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sumifsFormula(table: string, valueCol: string, groupCol: string): string {
  return sumifsFormulaMulti(table, valueCol, [{ column: groupCol, criteriaRef: thisRowCol(groupCol) }]);
}

/** criteriaRef is already an Excel expression (this-row ref or literal). */
export function sumifsFormulaMulti(
  table: string,
  valueCol: string,
  criteria: Array<{ column: string; criteriaRef: string }>
): string {
  if (!criteria.length) throw new Error("sumifs 至少需要一组条件列");
  let s = "=SUMIFS(" + structCol(table, valueCol);
  criteria.forEach(function (c) {
    s += "," + structCol(table, c.column) + "," + c.criteriaRef;
  });
  return s + ")";
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

export function sumifsFormulaSheet(
  sourceSheet: string,
  valueColLetter: string,
  groupColLetter: string,
  criteriaA1: string
): string {
  return sumifsFormulaSheetMulti(sourceSheet, valueColLetter, [
    { colLetter: groupColLetter, criteriaA1: criteriaA1 },
  ]);
}

export function sumifsFormulaSheetMulti(
  sourceSheet: string,
  valueColLetter: string,
  pairs: Array<{ colLetter: string; criteriaA1: string }>
): string {
  const sheetRef = quoteSheetName(sourceSheet);
  const valueRange = sheetRef + "!" + valueColLetter + ":" + valueColLetter;
  let s = "=SUMIFS(" + valueRange;
  pairs.forEach(function (p) {
    const groupRange = sheetRef + "!" + p.colLetter + ":" + p.colLetter;
    s += "," + groupRange + "," + p.criteriaA1;
  });
  return s + ")";
}

export function fixRefFormula(formula: string): string {
  let s = String(formula || "");
  s = s.replace(/,\s*#REF!/gi, "");
  s = s.replace(/#REF!\s*,/gi, "");
  s = s.replace(/#REF!/gi, "0");
  return s;
}

export function normalizeSheetCellRef(raw: string): string {
  const t = String(raw || "").trim();
  if (!t) throw new Error("sheetCell 不能为空");
  const bang = t.indexOf("!");
  if (bang < 0) throw new Error("sheetCell 须含工作表引用，如 假设参数!B3");
  const sheet = t.slice(0, bang).replace(/^'+|'+$/g, "");
  const cellRaw = t.slice(bang + 1).replace(/\$/g, "").toUpperCase();
  if (!/^[A-Z]+[0-9]+$/.test(cellRaw)) throw new Error("sheetCell 单元格无效: " + t);
  const m = cellRaw.match(/^([A-Z]+)([0-9]+)$/);
  if (!m) throw new Error("sheetCell 单元格无效: " + t);
  return quoteSheetName(sheet) + "!$" + m[1] + "$" + m[2];
}

export function arithmeticFormula(terms: ArithTerm[]): string {
  if (!terms || !terms.length) throw new Error("arithmetic 需要 expression.terms");
  let s = "=";
  terms.forEach(function (term, i) {
    const hasCol = term.column != null && String(term.column).trim() !== "";
    const hasLit = typeof term.literal === "number" && Number.isFinite(term.literal);
    const hasCell = term.sheetCell != null && String(term.sheetCell).trim() !== "";
    const n = (hasCol ? 1 : 0) + (hasLit ? 1 : 0) + (hasCell ? 1 : 0);
    if (n !== 1) throw new Error("arithmetic 每项只能有 column、literal、sheetCell 之一");
    if (i > 0) {
      const op = term.op || "+";
      if (op !== "+" && op !== "-" && op !== "*" && op !== "/") {
        throw new Error("arithmetic 运算符无效: " + op);
      }
      s += op;
    }
    if (hasCol) s += thisRowCol(String(term.column).trim());
    else if (hasLit) s += String(term.literal);
    else s += normalizeSheetCellRef(String(term.sheetCell));
  });
  return s;
}

function condOperand(expr: CondExpr | undefined, label: string): string {
  if (!expr) throw new Error("conditional_column 需要 " + label);
  const hasCol = expr.column != null && String(expr.column).trim() !== "";
  const hasLit = expr.literal !== undefined && expr.literal !== null;
  if (hasCol === hasLit) throw new Error(label + " 须指定 column 或 literal 之一");
  if (hasCol) return thisRowCol(String(expr.column).trim());
  return excelCriteriaLiteral(expr.literal as string | number | boolean);
}

export function conditionalFormula(
  column: string,
  operator: CondOperator,
  value: string | number,
  valueTo: string | number | undefined,
  trueExpr: CondExpr,
  falseExpr: CondExpr
): string {
  const left = thisRowCol(column);
  const t = condOperand(trueExpr, "trueExpr");
  const f = condOperand(falseExpr, "falseExpr");
  let test: string;
  if (operator === "between") {
    if (valueTo === undefined || valueTo === null) {
      throw new Error("between 需要 valueTo");
    }
    test =
      "AND(" +
      left +
      ">=" +
      excelCriteriaLiteral(value) +
      "," +
      left +
      "<=" +
      excelCriteriaLiteral(valueTo) +
      ")";
  } else {
    const opMap: Record<string, string> = {
      eq: "=",
      neq: "<>",
      gt: ">",
      gte: ">=",
      lt: "<",
      lte: "<=",
    };
    const sym = opMap[operator];
    if (!sym) throw new Error("conditional_column 运算符无效: " + operator);
    test = left + sym + excelCriteriaLiteral(value);
  }
  return "=IF(" + test + "," + t + "," + f + ")";
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
  bring.forEach(function (c) {
    headers.push(headers.indexOf(c) >= 0 ? c + "_lookup" : c);
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

type GroupTuple = Cell[];

function collectGroups(headersIn: string[], rows: Cell[][], groupCols: string[]): GroupTuple[] {
  const idxs = groupCols.map(function (c) {
    requireColumn(headersIn, c, "表");
    return headersIn.indexOf(c);
  });
  const seen = new Set<string>();
  const out: GroupTuple[] = [];
  rows.forEach(function (row) {
    const tuple = idxs.map(function (i) {
      return row[i];
    });
    const parts = tuple.map(function (g) {
      return g === null || g === undefined ? "" : String(g).trim();
    });
    if (
      parts.some(function (p) {
        return !p;
      })
    )
      return;
    const key = parts.join("\u0001");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(tuple);
  });
  return out;
}

function sumifs(input: CalculateInput): CalculateResult {
  const headersIn = input.headers || [];
  const tableName = input.tableName || "";
  const groupCols = normalizeGroupBy(input.groupBy);
  const valueColumn = input.valueColumn || "";
  const sourceSheet = String(input.sourceSheet || "").trim();
  const fixed = input.criteria || [];
  if (!tableName || !groupCols.length || !valueColumn) {
    throw new Error("sumifs 需要 tableName、groupBy、valueColumn");
  }
  requireColumn(headersIn, valueColumn, "表");
  fixed.forEach(function (c) {
    requireColumn(headersIn, c.column, "表");
    if (c.value === undefined || c.value === null) {
      throw new Error("criteria 项需要 value: " + c.column);
    }
  });
  const vIdx = headersIn.indexOf(valueColumn);
  let sourceRows = input.rows || [];
  if (fixed.length) {
    sourceRows = sourceRows.filter(function (row) {
      return fixed.every(function (c) {
        const idx = headersIn.indexOf(c.column);
        const cell = row[idx];
        const got = cell === null || cell === undefined ? "" : String(cell).trim();
        return got === String(c.value).trim();
      });
    });
  }
  const groups = collectGroups(headersIn, sourceRows, groupCols);
  const outHeaders = groupCols.concat(["合计"]);
  const rows = groups.map(function (tuple, i) {
    let formula: string;
    if (sourceSheet) {
      const rowNum = i + 2;
      const pairs: Array<{ colLetter: string; criteriaA1: string }> = [];
      groupCols.forEach(function (col, gi) {
        pairs.push({
          colLetter: colIndexToLetter(headersIn.indexOf(col)),
          criteriaA1: colIndexToLetter(gi) + rowNum,
        });
      });
      fixed.forEach(function (c) {
        pairs.push({
          colLetter: colIndexToLetter(headersIn.indexOf(c.column)),
          criteriaA1: excelCriteriaLiteral(c.value as string | number),
        });
      });
      formula = sumifsFormulaSheetMulti(sourceSheet, colIndexToLetter(vIdx), pairs);
    } else {
      const criteria = groupCols.map(function (col) {
        return { column: col, criteriaRef: thisRowCol(col) };
      });
      fixed.forEach(function (c) {
        criteria.push({
          column: c.column,
          criteriaRef: excelCriteriaLiteral(c.value as string | number),
        });
      });
      formula = sumifsFormulaMulti(tableName, valueColumn, criteria);
    }
    return tuple.concat([formula]);
  });
  return pack(outHeaders, rows);
}

function arithmetic(input: CalculateInput): CalculateResult {
  const headersIn = input.headers || [];
  const tableName = input.tableName || "";
  const outputColumn = String(input.outputColumn || "").trim() || "结果";
  const terms = (input.expression && input.expression.terms) || [];
  if (!tableName) throw new Error("arithmetic 需要 tableName");
  if (!terms.length) throw new Error("arithmetic 需要 expression.terms");
  terms.forEach(function (t) {
    if (t.column) requireColumn(headersIn, String(t.column).trim(), "表");
  });
  if (headersIn.indexOf(outputColumn) >= 0) {
    throw new Error("输出列已存在: " + outputColumn);
  }
  const formula = arithmeticFormula(terms);
  const headers = headersIn.concat([outputColumn]);
  const rows = (input.rows || []).map(function (row) {
    return row.slice().concat([formula]);
  });
  return pack(headers, rows);
}

function conditionalColumn(input: CalculateInput): CalculateResult {
  const headersIn = input.headers || [];
  const tableName = input.tableName || "";
  const column = String(input.column || "").trim();
  const operator = input.operator;
  const outputColumn = String(input.outputColumn || "").trim() || "条件结果";
  if (!tableName) throw new Error("conditional_column 需要 tableName");
  if (!column || !operator) throw new Error("conditional_column 需要 column、operator");
  if (input.value === undefined || input.value === null) {
    throw new Error("conditional_column 需要 value");
  }
  if (!input.trueExpr || !input.falseExpr) {
    throw new Error("conditional_column 需要 trueExpr、falseExpr");
  }
  requireColumn(headersIn, column, "表");
  if (input.trueExpr.column) requireColumn(headersIn, String(input.trueExpr.column).trim(), "表");
  if (input.falseExpr.column) requireColumn(headersIn, String(input.falseExpr.column).trim(), "表");
  if (headersIn.indexOf(outputColumn) >= 0) {
    throw new Error("输出列已存在: " + outputColumn);
  }
  const formula = conditionalFormula(
    column,
    operator,
    input.value,
    input.valueTo,
    input.trueExpr,
    input.falseExpr
  );
  const headers = headersIn.concat([outputColumn]);
  const rows = (input.rows || []).map(function (row) {
    return row.slice().concat([formula]);
  });
  return pack(headers, rows);
}

export function calculate(input: CalculateInput): CalculateResult {
  if (input.op === "lookup") return lookup(input);
  if (input.op === "sumifs" || input.op === "sumifs_multi") return sumifs(input);
  if (input.op === "arithmetic") return arithmetic(input);
  if (input.op === "conditional_column") return conditionalColumn(input);
  throw new Error("Unknown calculate op");
}
