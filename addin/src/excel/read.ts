/// <reference types="@types/office-js" />

export async function readSelection(): Promise<{
  values: string[][]; address: string; rowCount: number; colCount: number;
}> {
  return Excel.run(async (context) => {
    const range = context.workbook.getSelectedRange();
    range.load(['values', 'address', 'rowCount', 'columnCount']);
    await context.sync();
    return { values: range.values as string[][], address: range.address, rowCount: range.rowCount, colCount: range.columnCount };
  });
}

export async function readRange(sheetName: string, address: string): Promise<string[][]> {
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    range.load('values');
    await context.sync();
    return range.values as string[][];
  });
}
