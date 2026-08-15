/// <reference types="@types/office-js" />

import { CHUNK_ROWS, chunkRanges, FULL_LOAD_MAX_CELLS } from "./range-chunk";
import { parseA1Range, resolveTableName, sanitizeTableName } from "./table-name";

export interface EnsuredTable {
  name: string;
  sheet: string;
  address: string;
  headers: string[];
  dataRows: number;
  created: boolean;
}

async function uniqueTableName(context: Excel.RequestContext, base: string): Promise<string> {
  const tables = context.workbook.tables;
  tables.load("items/name");
  await context.sync();
  const taken = new Set(tables.items.map((t) => t.name));
  let name = sanitizeTableName(base);
  let i = 2;
  while (taken.has(name)) {
    name = sanitizeTableName(base).slice(0, 28) + i;
    i += 1;
  }
  return name;
}

export async function listTableNames(): Promise<string[]> {
  return Excel.run(async (context) => {
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();
    return tables.items.map((t) => t.name);
  });
}

export async function readTable(tableName: string): Promise<{
  name: string;
  sheet: string;
  headers: string[];
  rows: (string | number | boolean | null)[][];
}> {
  return Excel.run(async (context) => {
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();
    const existing = tables.items.map((t) => t.name);
    const resolved = resolveTableName(tableName, existing);
    const table = tables.getItem(resolved);
    const ws = table.worksheet;
    ws.load("name");
    const header = table.getHeaderRowRange();
    header.load("values");
    table.load("name");
    table.rows.load("count");
    await context.sync();
    const headers = (header.values[0] || []).map((c) => String(c ?? "").trim());
    const dataRows = table.rows.count;
    if (dataRows > 0 && dataRows * headers.length > FULL_LOAD_MAX_CELLS) {
      throw new Error(
        "表有 " +
          dataRows +
          " 行 × " +
          headers.length +
          " 列，超过一次载入上限。请先提取需要的列，或用去重（会分块处理）。"
      );
    }
    let rows: (string | number | boolean | null)[][] = [];
    if (table.rows.count > 0) {
      const body = table.getDataBodyRange();
      for (const ch of chunkRanges(table.rows.count, CHUNK_ROWS)) {
        const chunk = body.getRow(ch.start).getBoundingRect(body.getRow(ch.start + ch.count - 1));
        chunk.load("values");
        await context.sync();
        rows = rows.concat(chunk.values as (string | number | boolean | null)[][]);
      }
    }
    return { name: table.name, sheet: ws.name, headers, rows };
  });
}

export async function readTableMeta(tableName: string): Promise<{
  name: string;
  sheet: string;
  headers: string[];
  dataRows: number;
}> {
  return Excel.run(async (context) => {
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();
    const existing = tables.items.map((t) => t.name);
    const resolved = resolveTableName(tableName, existing);
    const table = tables.getItem(resolved);
    const ws = table.worksheet;
    ws.load("name");
    const header = table.getHeaderRowRange();
    header.load("values");
    table.load("name");
    table.rows.load("count");
    await context.sync();
    const headers = (header.values[0] || []).map((c) => String(c ?? "").trim());
    return { name: table.name, sheet: ws.name, headers: headers, dataRows: table.rows.count };
  });
}

export async function readTableBodyChunk(
  tableName: string,
  start: number,
  count: number
): Promise<(string | number | boolean | null)[][]> {
  if (count <= 0) return [];
  return Excel.run(async (context) => {
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();
    const existing = tables.items.map((t) => t.name);
    const resolved = resolveTableName(tableName, existing);
    const table = tables.getItem(resolved);
    const body = table.getDataBodyRange();
    const chunk = body.getRow(start).getBoundingRect(body.getRow(start + count - 1));
    chunk.load("values");
    await context.sync();
    return chunk.values as (string | number | boolean | null)[][];
  });
}

export async function ensureTable(
  sheetName: string,
  rangeAddress?: string,
  tableName?: string
): Promise<EnsuredTable> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const used = sheet.getUsedRangeOrNullObject();
    used.load(["address", "isNullObject"]);
    await context.sync();
    if (!rangeAddress && used.isNullObject) {
      throw new Error(`Sheet "${sheetName}" is empty; pass a range that includes the header row.`);
    }
    const a1 = parseA1Range(rangeAddress || used.address);
    if (!a1) {
      throw new Error("ensure_table needs a range like A1:D20 (header row included).");
    }
    const range = sheet.getRange(a1);
    const sheetTables = sheet.tables;
    sheetTables.load("items/name");
    await context.sync();

    const overlaps: Array<{ table: Excel.Table; hit: Excel.Range }> = [];
    for (const t of sheetTables.items) {
      const hit = t.getRange().getIntersectionOrNullObject(range);
      hit.load("isNullObject");
      overlaps.push({ table: t, hit });
    }
    await context.sync();
    const existing = overlaps.find((o) => !o.hit.isNullObject);
    if (existing) {
      const table = existing.table;
      table.load("name");
      const header = table.getHeaderRowRange();
      header.load(["values", "address"]);
      table.rows.load("count");
      const ws = table.worksheet;
      ws.load("name");
      await context.sync();
      let dataRows = 0;
      if (table.rows.count > 0) {
        const body = table.getDataBodyRange();
        body.load("rowCount");
        await context.sync();
        dataRows = body.rowCount;
      }
      return {
        name: table.name,
        sheet: ws.name,
        address: header.address,
        headers: (header.values[0] || []).map((c) => String(c ?? "").trim()),
        dataRows,
        created: false,
      };
    }

    const desiredName = await uniqueTableName(context, tableName || `${sheetName}_Table`);
    const table = sheet.tables.add(range, true);
    const header = table.getHeaderRowRange();
    header.load(["values", "address"]);
    table.rows.load("count");
    table.load("name");
    await context.sync();
    let dataRows = 0;
    if (table.rows.count > 0) {
      const body = table.getDataBodyRange();
      body.load("rowCount");
      await context.sync();
      dataRows = body.rowCount;
    }
    const headers = (header.values[0] || []).map((c) => String(c ?? "").trim());
    const address = header.address;
    let name = table.name;
    try {
      table.name = desiredName;
      await context.sync();
      name = desiredName;
    } catch {
      // Excel rejected the name; keep the auto-assigned ListObject name.
    }
    return {
      name,
      sheet: sheetName,
      address,
      headers,
      dataRows,
      created: true,
    };
  });
}
