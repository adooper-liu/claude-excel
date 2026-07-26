/// <reference types="@types/office-js" />

export async function getSheetNames(): Promise<string[]> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets; sheets.load('items/name'); await context.sync();
    return sheets.items.map(s => s.name);
  });
}

export async function setActiveSheet(sheetName: string): Promise<void> {
  await Excel.run(async (context) => { context.workbook.worksheets.getItem(sheetName).activate(); await context.sync(); });
}
