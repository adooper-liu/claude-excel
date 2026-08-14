/// <reference types="@types/office-js" />

import {
  calculate as calculateCore,
  fixRefFormula,
  type CalculateOp,
  type Cell,
} from "./calculate-core";
import { formulaColumnRuns, valuesWithoutFormulas } from "./range-chunk";
import { readTable } from "./table";
import { writeFormulaRuns, writeToNewSheet } from "./write";
import { deleteSheetIfExists } from "./sheet";
import { sheetHistory } from "./sheet-history";

export interface CalculateTableInput {
  op: CalculateOp;
  tableName?: string;
  leftTable?: string;
  rightTable?: string;
  key?: string;
  bringColumns?: string[];
  groupBy?: string;
  valueColumn?: string;
  sheetName?: string;
  outputSheet?: string;
}

const DEFAULT_SHEET: Record<CalculateOp, string> = {
  lookup: "查找结果",
  sumifs: "汇总结果",
  fix_ref: "公式修复",
};

async function uniqueSheetName(base: string): Promise<string> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();
    const taken = new Set(sheets.items.map((s) => s.name));
    const root = base.slice(0, 28);
    let name = root;
    let i = 2;
    while (taken.has(name)) {
      name = `${root}${i}`;
      i += 1;
    }
    return name;
  });
}

async function writeFormulaGrid(sheetName: string, grid: Cell[][]): Promise<void> {
  await writeToNewSheet(sheetName, valuesWithoutFormulas(grid));
  try {
    await Excel.run(async (context) => {
      const sheet = context.workbook.worksheets.getItem(sheetName);
      const used = sheet.getUsedRange();
      sheet.tables.add(used, true);
      await context.sync();
    });
    await writeFormulaRuns(sheetName, formulaColumnRuns(grid));
    await Excel.run(async (context) => {
      context.workbook.worksheets.getItem(sheetName).activate();
      await context.sync();
    });
  } catch (err) {
    await deleteSheetIfExists(sheetName);
    sheetHistory.popIfTop(sheetName);
    throw err;
  }
}

async function fixRefSheet(sheetName: string, outputSheet: string): Promise<{ cells: number }> {
  return Excel.run(async (context) => {
    const src = context.workbook.worksheets.getItem(sheetName);
    const used = src.getUsedRangeOrNullObject();
    used.load(["formulas", "values", "rowCount", "columnCount", "isNullObject"]);
    await context.sync();
    if (used.isNullObject) throw new Error('工作表 "' + sheetName + '" 是空的');
    const formulas = used.formulas as string[][];
    const values = used.values as (string | number)[][];
    const grid: (string | number)[][] = [];
    let cells = 0;
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
    return { cells, grid, outputSheet };
  }).then(async (r) => {
    await writeFormulaGrid(r.outputSheet, r.grid as Cell[][]);
    return { cells: r.cells };
  });
}

export async function calculateTable(input: CalculateTableInput): Promise<{
  outputSheet: string;
  op: CalculateOp;
  rows: number;
  formulaCells?: number;
}> {
  const outputSheet = await uniqueSheetName(input.outputSheet || DEFAULT_SHEET[input.op]);

  if (input.op === "fix_ref") {
    if (!input.sheetName) throw new Error("fix_ref 需要 sheetName");
    const r = await fixRefSheet(input.sheetName, outputSheet);
    return { outputSheet, op: input.op, rows: 0, formulaCells: r.cells };
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
    await writeFormulaGrid(outputSheet, result.outputRows);
    return { outputSheet, op: "lookup", rows: result.rows.length };
  }

  if (input.op === "sumifs") {
    if (!input.tableName || !input.groupBy || !input.valueColumn) {
      throw new Error("sumifs 需要 tableName、groupBy、valueColumn");
    }
    const table = await readTable(input.tableName);
    const result = calculateCore({
      op: "sumifs",
      tableName: table.name,
      headers: table.headers,
      rows: table.rows as Cell[][],
      groupBy: input.groupBy,
      valueColumn: input.valueColumn,
    });
    await writeFormulaGrid(outputSheet, result.outputRows);
    return { outputSheet, op: "sumifs", rows: result.rows.length };
  }

  throw new Error("Unknown calculate op");
}
