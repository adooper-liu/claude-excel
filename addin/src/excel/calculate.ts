/// <reference types="@types/office-js" />

import {
  calculate as calculateCore,
  fixRefFormula,
  type ArithTerm,
  type CalculateOp,
  type Cell,
  type CondExpr,
  type CondOperator,
  type SumifsCriterion,
} from "./calculate-core";
import { formulaColumnRuns, valuesWithoutFormulas, CHUNK_ROWS, chunkRanges } from "./range-chunk";
import { readTable, ensureTable } from "./table";
import { writeFormulaRuns, writeToNewSheet } from "./write";
import { deleteSheetIfExists } from "./sheet";
import { sheetHistory } from "./sheet-history";
import { uniqueWorkbookSheetName } from "./sheet-name";

export interface CalculateTableInput {
  op: CalculateOp;
  tableName?: string;
  leftTable?: string;
  rightTable?: string;
  key?: string;
  bringColumns?: string[];
  groupBy?: string | string[];
  valueColumn?: string;
  criteria?: SumifsCriterion[];
  sheetName?: string;
  outputSheet?: string;
  outputTable?: string;
  outputColumn?: string;
  expression?: { terms: ArithTerm[] };
  column?: string;
  operator?: CondOperator;
  value?: string | number;
  valueTo?: string | number;
  trueExpr?: CondExpr;
  falseExpr?: CondExpr;
}

const DEFAULT_SHEET: Record<CalculateOp, string> = {
  lookup: "查找结果",
  sumifs: "汇总结果",
  sumifs_multi: "汇总结果",
  fix_ref: "公式修复",
  arithmetic: "算术结果",
  conditional_column: "条件列",
};

async function writeFormulaGrid(
  requestedSheet: string,
  grid: Cell[][],
  opts?: { tableBase?: string; tableBeforeFormulas?: boolean }
): Promise<string> {
  const written = await writeToNewSheet(requestedSheet, valuesWithoutFormulas(grid));
  const tableBase = opts?.tableBase || requestedSheet;
  const tableBefore = opts?.tableBeforeFormulas !== false;
  try {
    if (tableBefore) {
      await ensureTable(written, undefined, tableBase);
    }
    await writeFormulaRuns(written, formulaColumnRuns(grid));
    await Excel.run(async (context) => {
      context.workbook.worksheets.getItem(written).activate();
      await context.sync();
    });
    return written;
  } catch (err) {
    await deleteSheetIfExists(written);
    sheetHistory.popIfTop(written);
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error("写公式表「" + written + "」失败：" + detail);
  }
}

async function fixRefSheet(sheetName: string, outputSheet: string): Promise<{ cells: number }> {
  const packed = await Excel.run(async (context) => {
    const src = context.workbook.worksheets.getItem(sheetName);
    const used = src.getUsedRangeOrNullObject();
    used.load(["rowCount", "columnCount", "isNullObject"]);
    await context.sync();
    if (used.isNullObject) throw new Error('工作表 "' + sheetName + '" 是空的');
    const rowCount = used.rowCount;
    const grid: (string | number)[][] = [];
    let cells = 0;
    for (const ch of chunkRanges(rowCount, CHUNK_ROWS)) {
      const chunk = used.getRow(ch.start).getBoundingRect(used.getRow(ch.start + ch.count - 1));
      chunk.load(["formulas", "values"]);
      await context.sync();
      const formulas = chunk.formulas as string[][];
      const values = chunk.values as (string | number)[][];
      for (let r = 0; r < formulas.length; r++) {
        const row: (string | number)[] = [];
        for (let c = 0; c < formulas[r].length; c++) {
          const f = formulas[r][c];
          if (typeof f === "string" && f.startsWith("=") && /#REF!/i.test(f)) {
            row.push(fixRefFormula(f));
            cells += 1;
          } else if (typeof f === "string" && f.startsWith("=")) {
            row.push(f);
          } else {
            const v = values[r][c];
            row.push(v === null || v === undefined ? "" : (v as string | number));
          }
        }
        grid.push(row);
      }
    }
    return { cells, grid };
  });
  await writeFormulaGrid(outputSheet, packed.grid as Cell[][]);
  return { cells: packed.cells };
}

export async function calculateTable(input: CalculateTableInput): Promise<{
  outputSheet: string;
  op: CalculateOp;
  rows: number;
  formulaCells?: number;
}> {
  const requestedSheet = await uniqueWorkbookSheetName(input.outputSheet || DEFAULT_SHEET[input.op]);

  if (input.op === "fix_ref") {
    if (!input.sheetName) throw new Error("fix_ref 需要 sheetName");
    const r = await fixRefSheet(input.sheetName, requestedSheet);
    return { outputSheet: requestedSheet, op: input.op, rows: 0, formulaCells: r.cells };
  }

  if (input.op === "lookup") {
    if (!input.leftTable || !input.rightTable || !input.key) {
      throw new Error("lookup 需要 leftTable、rightTable、key");
    }
    const bring = input.bringColumns || [];
    if (!bring.length) throw new Error("lookup 需要 bringColumns");
    const left = await readTable(input.leftTable);
    const right = await readTable(input.rightTable);
    const result = calculateCore({
      op: "lookup",
      leftTable: left.name,
      rightTable: right.name,
      leftHeaders: left.headers,
      leftRows: left.rows as Cell[][],
      rightHeaders: right.headers,
      key: input.key,
      bringColumns: bring,
    });
    const outputSheet = await writeFormulaGrid(requestedSheet, result.outputRows, {
      tableBase: input.outputTable || requestedSheet,
    });
    return { outputSheet, op: "lookup", rows: result.rows.length };
  }

  if (input.op === "sumifs" || input.op === "sumifs_multi") {
    if (!input.tableName || !input.groupBy || !input.valueColumn) {
      throw new Error("sumifs 需要 tableName、groupBy、valueColumn");
    }
    const table = await readTable(input.tableName);
    const result = calculateCore({
      op: input.op,
      tableName: table.name,
      sourceSheet: table.sheet,
      headers: table.headers,
      rows: table.rows as Cell[][],
      groupBy: input.groupBy,
      valueColumn: input.valueColumn,
      criteria: input.criteria,
    });
    const outputSheet = await writeFormulaGrid(requestedSheet, result.outputRows, {
      tableBase: input.outputTable || requestedSheet,
      tableBeforeFormulas: false,
    });
    return { outputSheet, op: input.op, rows: result.rows.length };
  }

  if (input.op === "arithmetic" || input.op === "conditional_column") {
    if (!input.tableName) throw new Error(input.op + " 需要 tableName");
    const table = await readTable(input.tableName);
    const result = calculateCore({
      op: input.op,
      tableName: table.name,
      headers: table.headers,
      rows: table.rows as Cell[][],
      outputColumn: input.outputColumn,
      expression: input.expression,
      column: input.column,
      operator: input.operator,
      value: input.value,
      valueTo: input.valueTo,
      trueExpr: input.trueExpr,
      falseExpr: input.falseExpr,
    });
    const outputSheet = await writeFormulaGrid(requestedSheet, result.outputRows, {
      tableBase: input.outputTable || requestedSheet,
    });
    return { outputSheet, op: input.op, rows: result.rows.length };
  }

  throw new Error("Unknown calculate op");
}
