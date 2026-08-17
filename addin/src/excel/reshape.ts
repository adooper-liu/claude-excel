/// <reference types="@types/office-js" />

import { reshape as reshapeCore, dedupeChunk, type Cell, type ReshapeInput, type ReshapeOp, type CoerceType, type ProjectColumnSpec } from "./reshape-core";
import { flattenHeader } from "./flatten-header-core";
import { readTable, readTableMeta, readTableBodyChunk } from "./table";
import { createSheetWithHeader, writeSheetRows, finishResultSheet, writeToNewSheet } from "./write";
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
  outputSheet?: string;
}

const DEFAULT_SHEET: Record<ReshapeOp, string> = {
  dedupe: "去重结果",
  unpivot: "反透视结果",
  split: "拆列结果",
  coerce: "类型结果",
  project: "映射结果",
  flatten_header: "拍平结果",
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

async function readRangeHeaderAndMeta(
  sheetName: string,
  rangeAddress: string,
  headerRows: number
): Promise<{ totalRows: number; totalCols: number; headerGrid: Cell[][] }> {
  return Excel.run(async function (context) {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(rangeAddress);
    range.load(["rowCount", "columnCount"]);
    await context.sync();
    const headerRange = range.getResizedRange(headerRows - range.rowCount, 0);
    headerRange.load("values");
    await context.sync();
    return {
      totalRows: range.rowCount,
      totalCols: range.columnCount,
      headerGrid: (headerRange.values as Cell[][]) || [],
    };
  });
}

async function readRangeBodyChunk(
  sheetName: string,
  rangeAddress: string,
  headerRows: number,
  start: number,
  count: number
): Promise<Cell[][]> {
  if (count <= 0) return [];
  return Excel.run(async function (context) {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(rangeAddress);
    range.load(["columnCount"]);
    await context.sync();
    const bodyRange = range
      .getOffsetRange(headerRows + start, 0)
      .getResizedRange(count - 1, range.columnCount - 1);
    bodyRange.load("values");
    await context.sync();
    return (bodyRange.values as Cell[][]) || [];
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

  const meta = await readRangeHeaderAndMeta(sheetName, a1, headerRows);
  if (meta.totalRows <= headerRows) {
    throw new Error("区域行数（" + meta.totalRows + "）必须大于表头行数（" + headerRows + "）。");
  }

  const previewBody = await readRangeBodyChunk(sheetName, a1, headerRows, 0, 1);
  const preview = flattenHeader({
    grid: meta.headerGrid.concat(previewBody),
    headerRows: headerRows,
    separator: separator,
  });

  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || DEFAULT_SHEET.flatten_header);
  await createSheetWithHeader(outputSheet, preview.headers);

  const dataRows = meta.totalRows - headerRows;
  let written = 0;
  for (const ch of chunkRanges(dataRows, CHUNK_ROWS)) {
    const body = await readRangeBodyChunk(sheetName, a1, headerRows, ch.start, ch.count);
    if (body.length) {
      await writeSheetRows(outputSheet, 1 + written, asWriteGrid(body));
      written += body.length;
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
