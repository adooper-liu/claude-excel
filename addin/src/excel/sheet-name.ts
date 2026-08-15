/// <reference types="@types/office-js" />

/** Excel sheet names are at most 31 characters. */
export function nextSheetName(base: string, taken: string[]): string {
  const used = new Set(taken);
  const root = (String(base || "取数").trim() || "取数").slice(0, 28);
  let name = root;
  let i = 2;
  while (used.has(name)) {
    const suffix = String(i);
    name = root.slice(0, 31 - suffix.length) + suffix;
    i += 1;
  }
  return name;
}

export async function uniqueWorkbookSheetName(base: string): Promise<string> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();
    return nextSheetName(base, sheets.items.map((s) => s.name));
  });
}
