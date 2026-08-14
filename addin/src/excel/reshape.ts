/// <reference types="@types/office-js" />

import { reshape as reshapeCore, type Cell, type ReshapeInput, type ReshapeOp, type CoerceType } from "./reshape-core";
import { readTable } from "./table";
import { writeToNewSheet } from "./write";

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

export async function reshapeTable(input: ReshapeTableInput): Promise<{
  outputSheet: string;
  op: ReshapeOp;
  rows: number;
  dropped?: number;
  converted?: number;
  blanked?: number;
}> {
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
  const outputSheet = await uniqueSheetName(input.outputSheet || DEFAULT_SHEET[input.op]);
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

  return {
    outputSheet,
    op: input.op,
    rows: result.rows.length,
    dropped: result.dropped,
    converted: result.converted,
    blanked: result.blanked,
  };
}
