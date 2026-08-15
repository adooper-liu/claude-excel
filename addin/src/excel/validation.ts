/// <reference types="@types/office-js" />

import { parseA1Range } from "./table-name";
import { buildValidationRule } from "./validation-core";

export type DataValidationInput = {
  sheetName: string;
  range: string;
  type: string;
  source?: string;
  operator?: string;
  formula1?: string;
  formula2?: string;
  formula?: string;
  errorMessage?: string;
  allowBlank?: boolean;
};

export async function applyDataValidation(input: DataValidationInput): Promise<{
  sheet: string;
  range: string;
  type: string;
}> {
  const sheetName = String(input.sheetName || "").trim();
  const address = parseA1Range(input.range);
  if (!sheetName || !address) throw new Error("data_validation 需要 sheetName 和 range");
  const planned = buildValidationRule(input);

  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    const dv = range.dataValidation;
    if (planned.kind === "clear") {
      dv.clear();
    } else {
      dv.rule = planned.rule as Excel.DataValidationRule;
      if (planned.allowBlank !== undefined) dv.ignoreBlanks = planned.allowBlank !== false;
      if (planned.errorMessage) {
        dv.errorAlert = {
          showAlert: true,
          title: "输入无效",
          message: planned.errorMessage,
          style: "Stop" as Excel.DataValidationAlertStyle,
        };
      }
    }
    await context.sync();
  });
  return { sheet: sheetName, range: address, type: String(input.type || "").trim() };
}
