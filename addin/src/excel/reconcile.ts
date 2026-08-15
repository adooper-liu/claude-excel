/// <reference types="@types/office-js" />

import { reconcile as reconcileCore, type Cell } from "./reconcile-core";
import { readTable } from "./table";
import { writeToNewSheet } from "./write";
import { uniqueWorkbookSheetName } from "./sheet-name";

export interface ReconcileTablesInput {
  leftTable: string;
  rightTable: string;
  keys: string[];
  compareColumns?: string[];
  outputSheet?: string;
}

export async function reconcileTables(input: ReconcileTablesInput): Promise<{
  outputSheet: string;
  counts: { matched: number; left_only: number; right_only: number; conflict: number };
  keys: string[];
}> {
  const left = await readTable(input.leftTable);
  const right = await readTable(input.rightTable);
  const result = reconcileCore({
    leftHeaders: left.headers,
    leftRows: left.rows as Cell[][],
    rightHeaders: right.headers,
    rightRows: right.rows as Cell[][],
    keys: input.keys,
    compareColumns: input.compareColumns,
  });

  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || "对账结果");
  const grid = result.outputRows.map((row) =>
    row.map((c) => (c === null || c === undefined ? "" : c))
  ) as (string | number)[][];
  await writeToNewSheet(outputSheet, grid);

  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(outputSheet);
    const used = sheet.getUsedRange();
    sheet.tables.add(used, true);
    sheet.activate();
    await context.sync();
  });

  return { outputSheet, counts: result.counts, keys: input.keys };
}
