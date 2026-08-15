/// <reference types="@types/office-js" />

import { parseA1Range } from "./table-name";
import { assertWritableInputs, normalizeA1, type InputWrite } from "./write-inputs-core";

export async function writeInputs(sheetName: string, cells: InputWrite[]): Promise<{
  sheet: string;
  written: string[];
}> {
  const list = (cells || []).filter((c) => String(c.address || "").trim());
  if (list.length === 0) throw new Error("write_inputs 需要至少一个格子，例如 B5");
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const formulasByA1: Record<string, string> = {};
    const ranges: Array<{ a1: string; range: Excel.Range; value: string | number | boolean }> = [];
    for (const cell of list) {
      const a1 = normalizeA1(parseA1Range(cell.address));
      const range = sheet.getRange(a1);
      range.load(["formulas", "address"]);
      ranges.push({ a1, range, value: cell.value });
    }
    await context.sync();
    for (const item of ranges) {
      const f = item.range.formulas && item.range.formulas[0] ? String(item.range.formulas[0][0] ?? "") : "";
      formulasByA1[item.a1] = f;
    }
    assertWritableInputs(formulasByA1, list.map((c) => ({ address: normalizeA1(parseA1Range(c.address)), value: c.value })));
    for (const item of ranges) {
      item.range.values = [[item.value as string | number]];
    }
    await context.sync();
    return { sheet: sheetName, written: ranges.map((r) => r.a1) };
  });
}
