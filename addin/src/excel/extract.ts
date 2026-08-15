/// <reference types="@types/office-js" />

import { extractChunk, uniqueHeaders, type CaseMode } from "./extract-core";
import { createSheetWithHeader, writeSheetRows, finishResultSheet } from "./write";
import { CHUNK_ROWS, chunkRanges } from "./range-chunk";
import { sheetHistory } from "./sheet-history";
import { undoResultSheet } from "./sheet";
import { uniqueWorkbookSheetName } from "./sheet-name";

export interface ExtractSelectionInput {
  sheetName?: string;
  range?: string;
  column?: string;
  caseMode?: CaseMode;
  unique?: boolean;
  outputSheet?: string;
}

export interface ExtractSelectionResult {
  outputSheet: string;
  header: string;
  rows: number;
  sourceRows: number;
  address: string;
  caseMode: CaseMode;
  unique: boolean;
  blankDropped: number;
  uniqueDropped: number;
}

function safeSheetName(header: string, unique: boolean): string {
  const raw = String(header || "提取")
    .replace(/[:\\/?*\[\]]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 18);
  return (raw || "提取") + (unique ? "_去重" : "_规范");
}

function fallbackHeader(colIndex: number): string {
  let n = colIndex + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const RESULT_SHEET = /_规范$|_去重$|对账|去重结果|反透视|拆列|类型结果|reshape|reconcile/i;

async function sheetExists(name: string): Promise<boolean> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();
    return sheets.items.some(function (s) {
      return s.name === name;
    });
  });
}

async function usedAddress(sheetName: string): Promise<string | null> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const used = sheet.getUsedRangeOrNullObject();
    used.load(["address", "isNullObject"]);
    await context.sync();
    if (used.isNullObject) return null;
    const addr = String(used.address || "");
    const bang = addr.lastIndexOf("!");
    return bang >= 0 ? addr.slice(bang + 1).replace(/\$/g, "") : addr.replace(/\$/g, "");
  });
}

async function findColumnByHeader(
  column: string
): Promise<{ sheetName: string; range: string } | null> {
  const want = String(column || "").trim();
  if (!want) return null;
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();
    const usedList: Array<{ name: string; used: Excel.Range }> = [];
    for (const sheet of sheets.items) {
      if (RESULT_SHEET.test(sheet.name)) continue;
      const used = sheet.getUsedRangeOrNullObject();
      used.load(["isNullObject", "rowCount", "columnCount"]);
      usedList.push({ name: sheet.name, used: used });
    }
    await context.sync();
    const headers: Array<{ name: string; used: Excel.Range; header: Excel.Range }> = [];
    for (const item of usedList) {
      if (item.used.isNullObject || item.used.rowCount < 2 || item.used.columnCount < 1) continue;
      const header = item.used.getRow(0);
      header.load("values");
      headers.push({ name: item.name, used: item.used, header: header });
    }
    await context.sync();
    const pending: Array<{ sheetName: string; range: Excel.Range }> = [];
    for (const item of headers) {
      const row = (item.header.values && item.header.values[0]) || [];
      let col = -1;
      for (let i = 0; i < row.length; i++) {
        if (String(row[i] ?? "").trim() === want) {
          col = i;
          break;
        }
      }
      if (col < 0) continue;
      const range = item.used
        .getCell(0, col)
        .getBoundingRect(item.used.getCell(item.used.rowCount - 1, col));
      range.load("address");
      pending.push({ sheetName: item.name, range: range });
    }
    await context.sync();
    const found = pending.map(function (h) {
      const addr = String(h.range.address || "");
      const bang = addr.lastIndexOf("!");
      return {
        sheetName: h.sheetName,
        range: (bang >= 0 ? addr.slice(bang + 1) : addr).replace(/\$/g, ""),
      };
    }).filter(function (h) {
      return !!h.range;
    });
    if (found.length === 1) return found[0];
    if (found.length === 0) return null;
    throw new Error(
      "有多张表有列「" +
        want +
        "」：" +
        found
          .map(function (h) {
            return h.sheetName;
          })
          .join("、") +
        "。请先选中要提取的那一列。"
    );
  });
}

async function resolveSource(
  input: ExtractSelectionInput
): Promise<{ sheetName?: string; range?: string }> {
  if (input.sheetName && input.range) {
    return { sheetName: input.sheetName, range: input.range };
  }
  const column = String(input.column || "").trim();
  if (input.unique) {
    const named = column ? column + "_规范" : "";
    if (named && (await sheetExists(named))) {
      const range = await usedAddress(named);
      if (range) return { sheetName: named, range: range };
    }
    const last = sheetHistory.peek();
    if (last && /_规范$/.test(last.sheet) && (await sheetExists(last.sheet))) {
      const range = await usedAddress(last.sheet);
      if (range) return { sheetName: last.sheet, range: range };
    }
  }
  if (column) {
    const found = await findColumnByHeader(column);
    if (found) return found;
    throw new Error("没有列「" + column + "」。请先选中该列，或检查表头是否叫这个名字。");
  }
  return { sheetName: input.sheetName, range: input.range };
}

async function loadRangeMeta(sheetName?: string, address?: string): Promise<{
  address: string;
  rowIndex: number;
  columnIndex: number;
  rowCount: number;
  columnCount: number;
  worksheetName: string;
}> {
  return Excel.run(async (context) => {
    let range: Excel.Range;
    let sheet: Excel.Worksheet;
    if (sheetName && address) {
      sheet = context.workbook.worksheets.getItem(sheetName);
      range = sheet.getRange(address);
    } else {
      range = context.workbook.getSelectedRange();
      sheet = range.worksheet;
    }
    sheet.load("name");
    range.load(["address", "rowIndex", "columnIndex", "rowCount", "columnCount"]);
    const used = sheet.getUsedRangeOrNullObject();
    used.load(["isNullObject", "rowIndex", "columnIndex", "rowCount", "columnCount"]);
    await context.sync();
    if (used.isNullObject) {
      throw new Error("请先选中要提取的列，再发送。");
    }
    const rowIndex = Math.max(range.rowIndex, used.rowIndex);
    const columnIndex = Math.max(range.columnIndex, used.columnIndex);
    const rowEnd = Math.min(range.rowIndex + range.rowCount, used.rowIndex + used.rowCount);
    const colEnd = Math.min(range.columnIndex + range.columnCount, used.columnIndex + used.columnCount);
    const rowCount = rowEnd - rowIndex;
    const columnCount = colEnd - columnIndex;
    if (rowCount < 1 || columnCount < 1) {
      throw new Error("请先选中要提取的列，再发送。");
    }
    return {
      address: range.address,
      rowIndex: rowIndex,
      columnIndex: columnIndex,
      rowCount: rowCount,
      columnCount: columnCount,
      worksheetName: sheet.name,
    };
  });
}

async function loadChunk(
  sheetName: string,
  startRow: number,
  startCol: number,
  rowCount: number,
  colCount: number
): Promise<unknown[][]> {
  if (rowCount < 1 || colCount < 1) return [];
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRangeByIndexes(startRow, startCol, rowCount, colCount);
    range.load("values");
    await context.sync();
    return range.values as unknown[][];
  });
}

async function peekHeadersAbove(
  worksheetName: string,
  rowIndex: number,
  columnIndex: number,
  colCount: number
): Promise<string[]> {
  if (rowIndex <= 0) return [];
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(worksheetName);
    const range = sheet.getRangeByIndexes(rowIndex - 1, columnIndex, 1, colCount);
    range.load("values");
    await context.sync();
    const row = (range.values && range.values[0]) || [];
    return Array.from({ length: colCount }, function (_x, i) {
      const v = row[i];
      const s = v == null ? "" : String(v).trim();
      return s || fallbackHeader(columnIndex + i);
    });
  });
}

function headersFromRow(row: unknown[], columnIndex: number): string[] {
  return (row || []).map(function (c, i) {
    const s = c == null ? "" : String(c).trim();
    return s || fallbackHeader(columnIndex + i);
  });
}

/** Read the selection (or a named range) in 2000-row blocks, normalize locally, write a new sheet. Never sends the column through the model or holds the full grid in JS. */
export async function extractSelection(
  input: ExtractSelectionInput = {}
): Promise<ExtractSelectionResult> {
  const source = await resolveSource(input);
  const meta = await loadRangeMeta(source.sheetName, source.range);
  const caseMode: CaseMode = input.caseMode || "title";
  const unique = !!input.unique;
  let headers: string[];
  let dataStart: number;
  let dataCount: number;
  if (meta.rowIndex === 0) {
    const first = await loadChunk(meta.worksheetName, 0, meta.columnIndex, 1, meta.columnCount);
    headers = uniqueHeaders(headersFromRow(first[0] || [], meta.columnIndex));
    dataStart = 1;
    dataCount = meta.rowCount - 1;
  } else {
    const peeked = await peekHeadersAbove(
      meta.worksheetName,
      meta.rowIndex,
      meta.columnIndex,
      meta.columnCount
    );
    headers = uniqueHeaders(peeked.length ? peeked : headersFromRow([], meta.columnIndex));
    dataStart = meta.rowIndex;
    dataCount = meta.rowCount;
  }
  if (dataCount < 1) {
    throw new Error("请先选中要提取的列，再发送。");
  }

  const outputSheet = await uniqueWorkbookSheetName(input.outputSheet || safeSheetName(headers[0], unique));
  await createSheetWithHeader(outputSheet, headers);

  const seen = unique ? new Set<string>() : null;
  let blankDropped = 0;
  let uniqueDropped = 0;
  let written = 0;
  try {
    for (const ch of chunkRanges(dataCount, CHUNK_ROWS)) {
      const values = await loadChunk(
        meta.worksheetName,
        dataStart + ch.start,
        meta.columnIndex,
        ch.count,
        meta.columnCount
      );
      const part = extractChunk(values, headers.length, caseMode, unique, seen);
      blankDropped += part.blankDropped;
      uniqueDropped += part.uniqueDropped;
      if (part.rows.length) {
        await writeSheetRows(outputSheet, 1 + written, part.rows);
        written += part.rows.length;
      }
    }
    if (written === 0) {
      throw new Error("选区规范化后没有可写入的值（全是空单元格）。");
    }
    await finishResultSheet(outputSheet, written, headers.length);
  } catch (err) {
    if (written === 0) {
      try {
        await undoResultSheet(outputSheet);
      } catch {
        /* sheet may already be gone */
      }
    }
    throw err;
  }

  return {
    outputSheet: outputSheet,
    header: headers.join("、"),
    rows: written,
    sourceRows: dataCount,
    address: meta.address,
    caseMode: caseMode,
    unique: unique,
    blankDropped: blankDropped,
    uniqueDropped: uniqueDropped,
  };
}
