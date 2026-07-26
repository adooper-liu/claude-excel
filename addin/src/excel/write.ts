/// <reference types="@types/office-js" />

export async function writeToNewSheet(sheetName: string, values: (string | number)[][]): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.add(sheetName);
    sheet.activate();
    if (values.length > 0 && values[0].length > 0) {
      const range = sheet.getRangeByIndexes(0, 0, values.length, values[0].length);
      range.values = values;
      range.getRow(0).format.font.bold = true;
    }
    await context.sync();
  });
}

export async function writeToRange(sheetName: string, address: string, values: (string | number)[][]): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    const rows = values.length; const cols = values[0]?.length || 1;
    range.getResizedRange(rows - 1, cols - 1).values = values;
    await context.sync();
  });
}

export async function writeFormulas(sheetName: string, address: string, formulas: (string | number)[][]): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    const rows = formulas.length; const cols = formulas[0]?.length || 1;
    range.getResizedRange(rows - 1, cols - 1).formulas = formulas as string[][];
    await context.sync();
  });
}
