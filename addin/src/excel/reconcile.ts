/// <reference types="@types/office-js" />

import {
  reconcile as reconcileCore,
  type Cell,
  type KeyNormalizeMode,
  type MatchMode,
} from "./reconcile-core";
import { ensureTable, readTable } from "./table";
import { writeToNewSheet } from "./write";
import { uniqueWorkbookSheetName } from "./sheet-name";

export interface ReconcileTablesInput {
  leftTable: string;
  rightTable: string;
  keys: string[];
  compareColumns?: string[];
  outputSheet?: string;
  /** Excel ListObject name; use ASCII to keep SUMIFS structured refs stable. */
  outputTable?: string;
  /** exact (default) | normalize | date_window */
  matchMode?: MatchMode;
  /** Key normalization for normalize / date_window stages. Default trim. */
  keyNormalize?: KeyNormalizeMode;
  /** Only with matchMode=date_window: ±N days window for second-pass pairing. */
  dateWindowDays?: number;
  /** Left date column header; must be one of keys when matchMode=date_window. */
  leftDateKey?: string;
  /** Right date column header; must be one of keys when matchMode=date_window. */
  rightDateKey?: string;
  /** Append __match_mode / __match_score / __review. Default: true when matchMode !== "exact". */
  auditColumns?: boolean;
  /** Numeric tolerance for compareColumns conflict comparison (not keys). 0 = exact (default). */
  compareTolerance?: number;
}

export async function reconcileTables(input: ReconcileTablesInput): Promise<{
  outputSheet: string;
  outputTable: string;
  counts: { matched: number; left_only: number; right_only: number; conflict: number };
  reviewPending: number;
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
    matchMode: input.matchMode,
    keyNormalize: input.keyNormalize,
    dateWindowDays: input.dateWindowDays,
    leftDateKey: input.leftDateKey,
    rightDateKey: input.rightDateKey,
    auditColumns: input.auditColumns,
    compareTolerance: input.compareTolerance,
  });

  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || "对账结果");
  const grid = result.outputRows.map((row) =>
    row.map((c) => (c === null || c === undefined ? "" : c))
  ) as (string | number)[][];
  await writeToNewSheet(outputSheet, grid);

  const tableBase = input.outputTable || input.outputSheet || "对账结果";
  const ensured = await ensureTable(outputSheet, undefined, tableBase);

  await Excel.run(async (context) => {
    context.workbook.worksheets.getItem(outputSheet).activate();
    await context.sync();
  });

  return {
    outputSheet,
    outputTable: ensured.name,
    counts: result.counts,
    reviewPending: result.reviewPending,
    keys: input.keys,
  };
}
