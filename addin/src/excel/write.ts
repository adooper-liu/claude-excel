/// <reference types="@types/office-js" />

import { CHUNK_ROWS, chunkRanges, type FormulaRun } from "./range-chunk";
import { sheetHistory } from "./sheet-history";

export async function writeToNewSheet(sheetName: string, values: (string | number)[][]): Promise<void> {
  await Excel.run(async (context) => {
    const active = context.workbook.worksheets.getActiveWorksheet();
    active.load("name");
    await context.sync();
    const previous = active.name;
    const sheet = context.workbook.worksheets.add(sheetName);
    sheet.activate();
    if (values.length > 0 && values[0].length > 0) {
      const cols = values[0].length;
      for (const ch of chunkRanges(values.length, CHUNK_ROWS)) {
        const slice = values.slice(ch.start, ch.start + ch.count);
        sheet.getRangeByIndexes(ch.start, 0, ch.count, cols).values = slice;
        await context.sync();
      }
      sheet.getRangeByIndexes(0, 0, 1, cols).format.font.bold = true;
    }
    await context.sync();
    sheetHistory.push(sheetName, previous);
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
