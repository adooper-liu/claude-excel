/// <reference types="@types/office-js" />

import { reshape as reshapeCore, dedupeChunk, coerceColumnsChunk, type Cell, type ReshapeInput, type ReshapeOp, type CoerceType, type ProjectColumnSpec } from "./reshape-core";
import { flattenHeader, preserveRowForFlatten } from "./flatten-header-core";
import {
  inferColumnFormats,
  textColumnIndexes,
  gridCellsForWrite,
  type ColumnFormatHint,
} from "./column-format-core";
import { readTable, readTableMeta, readTableBodyChunk, readTableBodyChunkWithText } from "./table";
import {
  createSheetWithHeader,
  writeSheetRows,
  finishResultSheet,
  writeToNewSheet,
  prepareTextColumns,
} from "./write";
import { CHUNK_ROWS, chunkRanges } from "./range-chunk";
import { uniqueWorkbookSheetName } from "./sheet-name";
import { parseA1Range } from "./table-name";

export interface ReshapeTableInput {
  tableName?: string;
  sheetName?: string;
  range?: string;
  headerRows?: number;
  op: ReshapeOp;
  keys?: string[];
  idColumns?: string[];
  valueColumns?: string[];
  attributeName?: string;
  valueName?: string;
  column?: string;
  separator?: string;
  maxParts?: number;
  type?: CoerceType;
  headerless?: boolean;
  columns?: ProjectColumnSpec[];
  formatHints?: ColumnFormatHint[];
  format?: "auto" | "manual";
  outputSheet?: string;
}

const DEFAULT_SHEET: Record<ReshapeOp, string> = {
  dedupe: "去重结果",
  unpivot: "反透视结果",
  split: "拆列结果",
  coerce: "类型结果",
  project: "映射结果",
  flatten_header: "拍平结果",
  coerce_columns: "格式结果",
  flatten_reconcile: "对账压平",
};

function asWriteGrid(rows: Cell[][]): (string | number)[][] {
  return rows.map(function (row) {
    return row.map(function (c) {
      return c === null || c === undefined ? "" : (c as string | number);
    });
  });
}

async function reshapeDedupeStreaming(input: ReshapeTableInput): Promise<{
  outputSheet: string;
  op: ReshapeOp;
  rows: number;
  dropped?: number;
}> {
  const meta = await readTableMeta(input.tableName!);
  const keys = input.keys && input.keys.length ? input.keys : meta.headers;
  const seen = new Set<string>();
  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || DEFAULT_SHEET.dedupe);
  await createSheetWithHeader(outputSheet, meta.headers);
  let dropped = 0;
  let written = 0;
  for (const ch of chunkRanges(meta.dataRows, CHUNK_ROWS)) {
    const body = await readTableBodyChunk(meta.name, ch.start, ch.count);
    const part = dedupeChunk(meta.headers, body as Cell[][], keys, seen);
    dropped += part.dropped;
    if (part.kept.length) {
      await writeSheetRows(outputSheet, 1 + written, asWriteGrid(part.kept));
      written += part.kept.length;
    }
  }
  await finishResultSheet(outputSheet, written, meta.headers.length);
  return { outputSheet: outputSheet, op: "dedupe", rows: written, dropped: dropped };
}

async function reshapeCoerceColumnsStreaming(input: ReshapeTableInput): Promise<{
  outputSheet: string;
  op: ReshapeOp;
  rows: number;
  converted?: number;
  blanked?: number;
}> {
  const meta = await readTableMeta(input.tableName!);
  let hints = input.formatHints;
  if (!hints || !hints.length) {
    const sampleN = Math.min(12, meta.dataRows);
    const sample =
      sampleN > 0 ? await readTableBodyChunk(meta.name, 0, sampleN) : ([] as Cell[][]);
    hints = inferColumnFormats(meta.headers, sample as Cell[][]);
  }
  const textCols = textColumnIndexes(hints);
  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || DEFAULT_SHEET.coerce_columns);
  await createSheetWithHeader(outputSheet, meta.headers);
  if (textCols.length && meta.dataRows > 0) {
    await prepareTextColumns(outputSheet, textCols, 1, meta.dataRows);
  }
  let written = 0;
  let converted = 0;
  let blanked = 0;
  for (const ch of chunkRanges(meta.dataRows, CHUNK_ROWS)) {
    const body = await readTableBodyChunkWithText(meta.name, ch.start, ch.count);
    const part = coerceColumnsChunk(
      meta.headers,
      body.values as Cell[][],
      hints,
      body.text
    );
    converted += part.converted;
    blanked += part.blanked;
    if (part.rows.length) {
      await writeSheetRows(
        outputSheet,
        1 + written,
        gridCellsForWrite(part.rows, hints),
        textCols
      );
      written += part.rows.length;
    }
  }
  await finishResultSheet(outputSheet, written, meta.headers.length);
  return {
    outputSheet: outputSheet,
    op: "coerce_columns",
    rows: written,
    converted: converted,
    blanked: blanked,
  };
}

async function loadRangeBounds(
  sheetName: string,
  rangeAddress: string
): Promise<{ rowIndex: number; columnIndex: number; rowCount: number; columnCount: number }> {
  return Excel.run(async function (context) {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(rangeAddress);
    range.load(["rowIndex", "columnIndex", "rowCount", "columnCount"]);
    await context.sync();
    return {
      rowIndex: range.rowIndex,
      columnIndex: range.columnIndex,
      rowCount: range.rowCount,
      columnCount: range.columnCount,
    };
  });
}

async function readRangeHeaderAndMeta(
  sheetName: string,
  bounds: { rowIndex: number; columnIndex: number; rowCount: number; columnCount: number },
  headerRows: number
): Promise<{ totalRows: number; totalCols: number; headerGrid: Cell[][] }> {
  return Excel.run(async function (context) {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const headerRange = sheet.getRangeByIndexes(
      bounds.rowIndex,
      bounds.columnIndex,
      headerRows,
      bounds.columnCount
    );
    headerRange.load("values");
    await context.sync();
    return {
      totalRows: bounds.rowCount,
      totalCols: bounds.columnCount,
      headerGrid: (headerRange.values as Cell[][]) || [],
    };
  });
}

async function readRangeBodyChunk(
  sheetName: string,
  bounds: { rowIndex: number; columnIndex: number; rowCount: number; columnCount: number },
  headerRows: number,
  start: number,
  count: number,
  idCols?: number[]
): Promise<{ values: Cell[][]; text: string[][] }> {
  if (count <= 0) return { values: [], text: [] };
  const loadText = !!(idCols && idCols.length);
  return Excel.run(async function (context) {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const bodyRange = sheet.getRangeByIndexes(
      bounds.rowIndex + headerRows + start,
      bounds.columnIndex,
      count,
      bounds.columnCount
    );
    bodyRange.load(loadText ? ["values", "text"] : "values");
    await context.sync();
    return {
      values: (bodyRange.values as Cell[][]) || [],
      text: loadText ? ((bodyRange.text as string[][]) || []) : [],
    };
  });
}

async function reshapeFlattenHeader(input: ReshapeTableInput): Promise<{
  outputSheet: string;
  op: ReshapeOp;
  rows: number;
}> {
  const sheetName = String(input.sheetName || "").trim();
  const rangeAddress = String(input.range || "").trim();
  if (!sheetName || !rangeAddress) {
    throw new Error("flatten_header 需要 sheetName 与 range（含双层表头与数据区域）。");
  }
  const a1 = parseA1Range(rangeAddress);
  if (!a1) throw new Error("flatten_header 的 range 须为 A1 形式，例如 A1:Z500。");
  const headerRows = Math.max(1, Math.floor(Number(input.headerRows) || 2));
  const separator = input.separator == null || input.separator === "" ? "_" : String(input.separator);

  const bounds = await loadRangeBounds(sheetName, a1);
  const meta = await readRangeHeaderAndMeta(sheetName, bounds, headerRows);
  if (meta.totalRows <= headerRows) {
    throw new Error("区域行数（" + meta.totalRows + "）必须大于表头行数（" + headerRows + "）。");
  }

  const previewBody = await readRangeBodyChunk(sheetName, bounds, headerRows, 0, 1);
  const preview = flattenHeader({
    grid: meta.headerGrid.concat(previewBody.values),
    headerRows: headerRows,
    separator: separator,
  });
  const columnHints = inferColumnFormats(preview.headers, previewBody.values);
  const textCols = textColumnIndexes(columnHints);

  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || DEFAULT_SHEET.flatten_header);
  await createSheetWithHeader(outputSheet, preview.headers);

  const dataRows = meta.totalRows - headerRows;
  if (textCols.length && dataRows > 0) {
    await prepareTextColumns(outputSheet, textCols, 1, dataRows);
  }
  let written = 0;
  for (const ch of chunkRanges(dataRows, CHUNK_ROWS)) {
    const body = await readRangeBodyChunk(sheetName, bounds, headerRows, ch.start, ch.count, textCols);
    if (body.values.length) {
      // 结构性拍平：不改数值（时间值原样保留）。仅 id 文本列用显示文本保真防科学计数法。
      const rows = body.values.map(function (row, ri) {
        return preserveRowForFlatten(row, textCols, body.text[ri]);
      });
      await writeSheetRows(
        outputSheet,
        1 + written,
        gridCellsForWrite(rows, columnHints),
        textCols
      );
      written += body.values.length;
    }
  }
  await finishResultSheet(outputSheet, written, preview.headers.length);
  return { outputSheet: outputSheet, op: "flatten_header", rows: written };
}

export async function reshapeTable(input: ReshapeTableInput): Promise<{
  outputSheet: string;
  op: ReshapeOp;
  rows: number;
  dropped?: number;
  converted?: number;
  blanked?: number;
}> {
  if (input.op === "flatten_header") {
    return reshapeFlattenHeader(input);
  }
  if (input.op === "coerce_columns") {
    if (!input.tableName) throw new Error("coerce_columns 需要 tableName。");
    return reshapeCoerceColumnsStreaming(input as ReshapeTableInput & { tableName: string });
  }
  if (input.op === "dedupe") {
    if (!input.tableName) throw new Error("dedupe 需要 tableName。");
    return reshapeDedupeStreaming(input as ReshapeTableInput & { tableName: string });
  }
  if (!input.tableName) throw new Error(input.op + " 需要 tableName。");
  const table = await readTable(input.tableName);
  const coreInput: ReshapeInput = {
    headers: table.headers,
    rows: table.rows as Cell[][],
    op: input.op,
    keys: input.keys,
    idColumns: input.idColumns,
    valueColumns: input.valueColumns,
    attributeName: input.attributeName,
    valueName: input.valueName,
    column: input.column,
    separator: input.separator,
    maxParts: input.maxParts,
    type: input.type,
    headerless: input.headerless,
    columns: input.columns,
    formatHints: input.formatHints,
  };
  const result = reshapeCore(coreInput);
  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || DEFAULT_SHEET[input.op]);
  const grid = result.outputRows.map((row) =>
    row.map((c) => (c === null || c === undefined ? "" : c))
  ) as (string | number)[][];
  await writeToNewSheet(outputSheet, grid);
  await finishResultSheet(outputSheet, result.rows.length, result.headers.length);

  return {
    outputSheet,
    op: input.op,
    rows: result.rows.length,
    dropped: result.dropped,
    converted: result.converted,
    blanked: result.blanked,
  };
}
