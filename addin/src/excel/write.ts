/// <reference types="@types/office-js" />

import { CHUNK_ROWS, chunkRanges, TABLE_ADD_MAX_ROWS, type FormulaRun } from "./range-chunk";
import { rowsToAppend } from "./append-rows";
import { nextSheetName } from "./sheet-name";
import { sheetHistory } from "./sheet-history";

function hasData(values: (string | number)[][] | null | undefined): boolean {
  return Boolean(
    values &&
      values.some((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim()))
  );
}

export async function writeToNewSheet(sheetName: string, values: (string | number)[][]): Promise<string> {
  if (!hasData(values)) {
    throw new Error("没有可写的数据。请选一张有内容的表再写入。");
  }
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    const active = sheets.getActiveWorksheet();
    sheets.load("items/name");
    active.load("name");
    await context.sync();
    const previous = active.name;
    const name = nextSheetName(sheetName, sheets.items.map((s) => s.name));
    const sheet = sheets.add(name);
    sheet.activate();
    const cols = Math.max(...values.map((r) => (r && r.length) || 0), 1);
    for (const ch of chunkRanges(values.length, CHUNK_ROWS)) {
      const slice = values.slice(ch.start, ch.start + ch.count).map((r) => {
        const copy = (r || []).slice();
        while (copy.length < cols) copy.push("");
        return copy;
      });
      sheet.getRangeByIndexes(ch.start, 0, ch.count, cols).values = slice;
      await context.sync();
    }
    sheet.getRangeByIndexes(0, 0, 1, cols).format.font.bold = true;
    await context.sync();
    sheetHistory.push(name, previous);
    return name;
  });
}

/** Append rows to an existing result sheet. Skips a repeated header row. */
export async function appendSheetRows(
  sheetName: string,
  rows: (string | number)[][]
): Promise<number> {
  if (!rows.length) return 0;
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const used = sheet.getUsedRangeOrNullObject();
    used.load(["rowCount", "columnCount", "values"]);
    await context.sync();
    if (used.isNullObject) {
      const cols = rows[0].length;
      for (const ch of chunkRanges(rows.length, CHUNK_ROWS)) {
        const slice = rows.slice(ch.start, ch.start + ch.count);
        sheet.getRangeByIndexes(ch.start, 0, ch.count, cols).values = slice;
        await context.sync();
      }
      sheet.activate();
      await context.sync();
      return rows.length;
    }
    const header = (used.values && used.values[0]) || [];
    const toWrite = rowsToAppend(header as (string | number)[], rows);
    if (!toWrite.length) return 0;
    const cols = Math.max(used.columnCount || 0, toWrite[0].length);
    const startRow = used.rowCount;
    for (const ch of chunkRanges(toWrite.length, CHUNK_ROWS)) {
      const slice = toWrite.slice(ch.start, ch.start + ch.count).map((r) => {
        const copy = r.slice();
        while (copy.length < cols) copy.push("");
        return copy;
      });
      sheet.getRangeByIndexes(startRow + ch.start, 0, slice.length, cols).values = slice;
      await context.sync();
    }
    sheet.activate();
    await context.sync();
    return toWrite.length;
  });
}

/** Create an empty result sheet with a header row. Used by streaming extract/dedupe. */
export async function createSheetWithHeader(
  sheetName: string,
  headers: (string | number)[]
): Promise<void> {
  if (!headers.length) throw new Error("createSheetWithHeader needs a header row");
  await Excel.run(async (context) => {
    const active = context.workbook.worksheets.getActiveWorksheet();
    active.load("name");
    await context.sync();
    const previous = active.name;
    const names = context.workbook.worksheets;
    names.load("items/name");
    await context.sync();
    const unique = nextSheetName(sheetName, names.items.map((s) => s.name));
    const sheet = context.workbook.worksheets.add(unique);
    sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers];
    sheet.getRangeByIndexes(0, 0, 1, headers.length).format.font.bold = true;
    sheet.activate();
    await context.sync();
    sheetHistory.push(unique, previous);
  });
}

/** Write a block of data rows starting at 0-based `startRow`. Does not keep other rows in memory. */
export async function writeSheetRows(
  sheetName: string,
  startRow: number,
  rows: (string | number)[][]
): Promise<void> {
  if (!rows.length || !rows[0] || !rows[0].length) return;
  const cols = rows[0].length;
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    for (const ch of chunkRanges(rows.length, CHUNK_ROWS)) {
      const slice = rows.slice(ch.start, ch.start + ch.count);
      sheet.getRangeByIndexes(startRow + ch.start, 0, ch.count, cols).values = slice;
      await context.sync();
    }
  });
}

/** Optional Excel Table — skipped on huge sheets so 十万+ rows do not hang tables.add. */
export async function finishResultSheet(
  sheetName: string,
  dataRows: number,
  colCount: number
): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    if (dataRows > 0 && dataRows < TABLE_ADD_MAX_ROWS && colCount > 0) {
      const used = sheet.getRangeByIndexes(0, 0, dataRows + 1, colCount);
      sheet.tables.add(used, true);
    }
    sheet.activate();
    await context.sync();
  });
}

export async function writeToRange(sheetName: string, address: string, values: (string | number)[][]): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    const rows = values.length; const cols = values[0]?.length || 1;
    range.getResizedRange(rows - 1, cols - 1).values = values;
    await context.sync();
  });
}

export async function writeFormulas(sheetName: string, address: string, formulas: (string | number)[][]): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    const rows = formulas.length; const cols = formulas[0]?.length || 1;
    range.getResizedRange(rows - 1, cols - 1).formulas = formulas as string[][];
    await context.sync();
  });
}

/** Write formula columns as range blocks (never one cell per proxy call). */
export async function writeFormulaRuns(sheetName: string, runs: FormulaRun[]): Promise<void> {
  if (!runs.length) return;
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    for (const run of runs) {
      for (const ch of chunkRanges(run.formulas.length, CHUNK_ROWS)) {
        const slice = run.formulas.slice(ch.start, ch.start + ch.count);
        sheet.getRangeByIndexes(run.startRow + ch.start, run.col, ch.count, 1).formulas = slice;
        await context.sync();
      }
    }
  });
}
