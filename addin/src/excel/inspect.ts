/// <reference types="@types/office-js" />

import { inspectSampleRows } from "./range-chunk";
import { parseA1Range, resolveTableName } from "./table-name";

export interface SheetInfo {
  name: string;
  usedAddress: string | null;
  range: string | null;
  rows: number;
  cols: number;
  headers: string[];
  tableNames: string[];
}

export interface TableInfo {
  name: string;
  sheet: string;
  address: string;
  headers: string[];
  dataRows: number;
  sampleRows: (string | number | boolean | null)[][];
}

export interface WorkbookInspect {
  sheets: SheetInfo[];
  tables: TableInfo[];
}

function headerRow(values: unknown[][] | undefined): string[] {
  if (!values || values.length === 0) return [];
  return (values[0] || []).map((c) => String(c ?? "").trim());
}

export async function inspectWorkbook(): Promise<WorkbookInspect> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();

    const usedBySheet: Excel.Range[] = [];
    for (const sheet of sheets.items) {
      const used = sheet.getUsedRangeOrNullObject();
      used.load(["address", "rowCount", "columnCount", "isNullObject"]);
      usedBySheet.push(used);
    }

    const tableDetails: Array<{
      table: Excel.Table;
      ws: Excel.Worksheet;
      header: Excel.Range;
    }> = [];
    for (const table of tables.items) {
      const ws = table.worksheet;
      ws.load("name");
      const header = table.getHeaderRowRange();
      header.load(["values", "address"]);
      table.load("name");
      table.rows.load("count");
      tableDetails.push({ table, ws, header });
    }
    await context.sync();

    const sheetHeaderRanges: Array<Excel.Range | null> = usedBySheet.map((used) => {
      if (used.isNullObject) return null;
      const header = used.getRow(0);
      header.load("values");
      return header;
    });

    const sampleRanges: Array<{ dataRows: number; sample: Excel.Range | null }> = tableDetails.map((t) => {
      const dataRows = t.table.rows.count;
      const n = inspectSampleRows(dataRows);
      if (n <= 0) return { dataRows, sample: null };
      const body = t.table.getDataBodyRange();
      const sample = body.getRow(0).getBoundingRect(body.getRow(n - 1));
      sample.load("values");
      return { dataRows, sample };
    });
    await context.sync();

    const tablesBySheet = new Map<string, string[]>();
    const tableInfos: TableInfo[] = [];
    tableDetails.forEach((t, i) => {
      const sheetName = t.ws.name;
      const list = tablesBySheet.get(sheetName) || [];
      list.push(t.table.name);
      tablesBySheet.set(sheetName, list);
      const sample = sampleRanges[i].sample;
      tableInfos.push({
        name: t.table.name,
        sheet: sheetName,
        address: t.header.address,
        headers: headerRow(t.header.values as unknown[][]),
        dataRows: sampleRanges[i].dataRows,
        sampleRows: sample
          ? ((sample.values as unknown[][]) || []) as (string | number | boolean | null)[][]
          : [],
      });
    });

    const sheetInfos: SheetInfo[] = sheets.items.map((sheet, i) => {
      const used = usedBySheet[i];
      const empty = used.isNullObject;
      const header = sheetHeaderRanges[i];
      return {
        name: sheet.name,
        usedAddress: empty ? null : used.address,
        range: empty ? null : parseA1Range(used.address),
        rows: empty ? 0 : used.rowCount,
        cols: empty ? 0 : used.columnCount,
        headers: empty || !header ? [] : headerRow(header.values as unknown[][]),
        tableNames: tablesBySheet.get(sheet.name) || [],
      };
    });

    return { sheets: sheetInfos, tables: tableInfos };
  });
}

export async function inspectTable(tableName: string): Promise<TableInfo> {
  const wb = await inspectWorkbook();
  const resolved = resolveTableName(tableName, wb.tables.map((t) => t.name));
  const found = wb.tables.find((t) => t.name === resolved);
  if (!found) {
    throw new Error(
      `Table "${tableName}" not found. Existing tables: ${wb.tables.map((t) => t.name).join(", ") || "(none)"}`
    );
  }
  return found;
}
