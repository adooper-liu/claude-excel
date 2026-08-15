/// <reference types="@types/office-js" />

import { CHUNK_ROWS, chunkRanges } from "./range-chunk";
import { summarizeGrid, type FormulaErrorHit, type FormulaSummary } from "./formula-inspect-core";
import { parseA1Range, resolveTableName } from "./table-name";

const MAX_ERRORS = 40;
const MAX_SAMPLE = 12;

export type FormulaInspectResult = FormulaSummary & {
  sheet: string;
  address: string;
  tableName?: string;
};

function loadUsedOrAddress(sheet: Excel.Worksheet, address?: string): Excel.Range {
  if (address && String(address).trim()) {
    return sheet.getRange(parseA1Range(address));
  }
  return sheet.getUsedRangeOrNullObject();
}

async function inspectRange(
  context: Excel.RequestContext,
  range: Excel.Range,
  skipHeader: boolean
): Promise<FormulaSummary & { address: string }> {
  range.load(["address", "rowCount", "columnCount", "rowIndex", "columnIndex", "isNullObject"]);
  await context.sync();
  if ((range as Excel.Range & { isNullObject?: boolean }).isNullObject) {
    return {
      address: "",
      rows: 0,
      cols: 0,
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
  }
  const rowCount = range.rowCount;
  const colCount = range.columnCount;
  const startRow1 = range.rowIndex + 1;
  const startCol1 = range.columnIndex + 1;
  const address = parseA1Range(range.address);

  const merged: FormulaSummary = {
    rows: rowCount,
    cols: colCount,
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

  for (const ch of chunkRanges(rowCount, CHUNK_ROWS)) {
    const chunk = range.getRow(ch.start).getBoundingRect(range.getRow(ch.start + ch.count - 1));
    chunk.load(["formulas", "values", "valueTypes"]);
    await context.sync();
    const part = summarizeGrid(chunk.formulas as unknown[][], chunk.values as unknown[][], {
      startRow1: startRow1 + ch.start,
      startCol1,
      skipHeader: skipHeader && ch.start === 0,
      maxErrors: MAX_ERRORS - merged.errorHits.length,
      maxSample: MAX_SAMPLE,
      valueTypes: chunk.valueTypes as unknown[][],
    });
    merged.empty += part.empty;
    merged.labels += part.labels;
    merged.inputs += part.inputs;
    merged.formulas += part.formulas;
    merged.crossSheet += part.crossSheet;
    merged.errors += part.errors;
    merged.errorHits = merged.errorHits.concat(part.errorHits).slice(0, MAX_ERRORS);
    merged.formulaSample = merged.formulaSample.concat(part.formulaSample).slice(0, MAX_SAMPLE);
    merged.inputSample = merged.inputSample.concat(part.inputSample).slice(0, MAX_SAMPLE);
  }
  return { ...merged, address };
}

export async function inspectFormulas(input: {
  sheetName?: string;
  range?: string;
  tableName?: string;
}): Promise<FormulaInspectResult> {
  return Excel.run(async (context) => {
    if (input.tableName) {
      const tables = context.workbook.tables;
      tables.load("items/name");
      await context.sync();
      const resolved = resolveTableName(
        String(input.tableName),
        tables.items.map((t) => t.name)
      );
      const table = tables.getItem(resolved);
      const ws = table.worksheet;
      ws.load("name");
      const body = table.getRange();
      await context.sync();
      const summary = await inspectRange(context, body, true);
      return { ...summary, sheet: ws.name, tableName: resolved };
    }
    const sheetName = String(input.sheetName || "").trim();
    if (!sheetName) throw new Error("需要 sheetName 或 tableName");
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = loadUsedOrAddress(sheet, input.range);
    const summary = await inspectRange(context, range, false);
    return { ...summary, sheet: sheetName };
  });
}

export async function scanFormulaErrors(input?: { sheetName?: string }): Promise<{
  sheetsScanned: number;
  errorCount: number;
  errors: Array<FormulaErrorHit & { sheet: string }>;
}> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();
    const want = String(input?.sheetName || "").trim();
    const targets = want ? sheets.items.filter((s) => s.name === want) : sheets.items;
    if (want && targets.length === 0) {
      throw new Error('工作表 "' + want + '" 不存在');
    }
    const errors: Array<FormulaErrorHit & { sheet: string }> = [];
    for (const sheet of targets) {
      const used = sheet.getUsedRangeOrNullObject();
      used.load(["address", "rowCount", "columnCount", "rowIndex", "columnIndex", "isNullObject"]);
      await context.sync();
      if (used.isNullObject) continue;
      const startRow1 = used.rowIndex + 1;
      const startCol1 = used.columnIndex + 1;
      for (const ch of chunkRanges(used.rowCount, CHUNK_ROWS)) {
        if (errors.length >= MAX_ERRORS) break;
        const chunk = used.getRow(ch.start).getBoundingRect(used.getRow(ch.start + ch.count - 1));
        chunk.load(["formulas", "values", "valueTypes"]);
        await context.sync();
        const part = summarizeGrid(chunk.formulas as unknown[][], chunk.values as unknown[][], {
          startRow1: startRow1 + ch.start,
          startCol1,
          maxErrors: MAX_ERRORS - errors.length,
          maxSample: 0,
          valueTypes: chunk.valueTypes as unknown[][],
        });
        for (const hit of part.errorHits) {
          errors.push({ ...hit, sheet: sheet.name });
        }
      }
    }
    return { sheetsScanned: targets.length, errorCount: errors.length, errors };
  });
}
