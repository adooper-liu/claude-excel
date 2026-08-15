/// <reference types="@types/office-js" />

import { reshape as reshapeCore, dedupeChunk, type Cell, type ReshapeInput, type ReshapeOp, type CoerceType } from "./reshape-core";
import { readTable, readTableMeta, readTableBodyChunk } from "./table";
import { createSheetWithHeader, writeSheetRows, finishResultSheet, writeToNewSheet } from "./write";
import { CHUNK_ROWS, chunkRanges } from "./range-chunk";
import { uniqueWorkbookSheetName } from "./sheet-name";

export interface ReshapeTableInput {
  tableName: string;
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
  outputSheet?: string;
}

const DEFAULT_SHEET: Record<ReshapeOp, string> = {
  dedupe: "去重结果",
  unpivot: "反透视结果",
  split: "拆列结果",
  coerce: "类型结果",
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
  const meta = await readTableMeta(input.tableName);
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

export async function reshapeTable(input: ReshapeTableInput): Promise<{
  outputSheet: string;
  op: ReshapeOp;
  rows: number;
  dropped?: number;
  converted?: number;
  blanked?: number;
}> {
  if (input.op === "dedupe") {
    return reshapeDedupeStreaming(input);
  }
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
