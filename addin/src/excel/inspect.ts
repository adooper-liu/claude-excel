/// <reference types="@types/office-js" />

import { indexToCol } from "./formula-inspect-core";
import { inspectSampleRows } from "./range-chunk";
import { parseA1Range, resolveTableName } from "./table-name";
import { inferColumnFormats, type ColumnFormatHint } from "./column-format-core";

export interface TableColumnMeta {
  index: number;
  letter: string;
  header: string;
}

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
  columns: TableColumnMeta[];
  dataRows: number;
  sampleRows: (string | number | boolean | null)[][];
  likelyHeaderless?: boolean;
  reshapeHint?: string;
  columnHints?: ColumnFormatHint[];
}

function columnMeta(headers: string[]): TableColumnMeta[] {
  return headers.map(function (h, i) {
    return { index: i, letter: indexToCol(i), header: String(h ?? "").trim() };
  });
}

function likelyHeaderlessTable(sheetName: string, headers: string[], sampleRows: TableInfo["sampleRows"]): boolean {
  if (!/取数_/i.test(sheetName)) return false;
  if (headers.length < 4) return false;
  const r1 = sampleRows[0] || [];
  let same = 0;
  for (let i = 0; i < headers.length; i++) {
    if (String(headers[i] ?? "").trim() === String(r1[i] ?? "").trim()) same += 1;
  }
  if (sampleRows.length && same > headers.length * 0.5) return true;
  const noisy = headers.filter(function (c) {
    return /CNY|¥|\$\s?\d|颗星|选项:/i.test(String(c)) || /^\+?\d+(\.\d+)?$/.test(String(c).trim());
  }).length;
  return noisy >= 2;
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
      const headers = headerRow(t.header.values as unknown[][]);
      const sampleRows = sample
        ? ((sample.values as unknown[][]) || []) as (string | number | boolean | null)[][]
        : [];
      const headerless = likelyHeaderlessTable(sheetName, headers, sampleRows);
      const columnHints = sampleRows.length ? inferColumnFormats(headers, sampleRows) : inferColumnFormats(headers, []);
      tableInfos.push({
        name: t.table.name,
        sheet: sheetName,
        address: t.header.address,
        headers: headers,
        columns: columnMeta(headers),
        dataRows: sampleRanges[i].dataRows,
        sampleRows: sampleRows,
        likelyHeaderless: headerless,
        columnHints: columnHints,
        reshapeHint: headerless
          ? "首行可能是数据不是表头。规整列用 reshape_table op=project headerless:true；from/merge 用 columns[].index 或 letter，不要用 read_range。"
          : columnHints.some(function (c) {
                return c.kind === "id_text";
              })
            ? "含单号/面单类列：写结果表用 reshape_table op=coerce_columns format:auto，或 flatten_header 自动按 columnHints 写文本。"
            : undefined,
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
