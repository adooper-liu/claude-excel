/// <reference types="@types/office-js" />

import { parseA1Range } from "./table-name";
import { expandFillDown, expandFillRight, parseFillType, type FillBox } from "./fill-core";

export type FillRangeInput = {
  sheetName: string;
  range: string;
  destination?: string;
  direction?: string;
  fillType?: string;
};

function boxToA1(sheet: Excel.Worksheet, box: FillBox): Excel.Range {
  return sheet.getRangeByIndexes(box.row, box.col, box.rowCount, box.colCount);
}

export async function fillRange(input: FillRangeInput): Promise<{
  sheet: string;
  source: string;
  destination: string;
  fillType: string;
}> {
  const sheetName = String(input.sheetName || "").trim();
  const sourceAddr = parseA1Range(input.range);
  if (!sheetName || !sourceAddr) throw new Error("fill_range 需要 sheetName 和 range");
  const fillType = parseFillType(input.fillType);
  const direction = String(input.direction || "down").trim().toLowerCase() === "right" ? "right" : "down";

  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const source = sheet.getRange(sourceAddr);
    source.load(["address", "rowIndex", "columnIndex", "rowCount", "columnCount"]);
    let dest: Excel.Range;
    if (input.destination && String(input.destination).trim()) {
      dest = sheet.getRange(parseA1Range(input.destination));
    } else {
      const used = sheet.getUsedRangeOrNullObject();
      used.load(["rowIndex", "rowCount", "columnIndex", "columnCount", "isNullObject"]);
      await context.sync();
      if ((used as Excel.Range & { isNullObject?: boolean }).isNullObject) {
        throw new Error("工作表是空的，无法填充");
      }
      const srcBox: FillBox = {
        row: source.rowIndex,
        col: source.columnIndex,
        rowCount: source.rowCount,
        colCount: source.columnCount,
      };
      const destBox =
        direction === "right"
          ? expandFillRight(srcBox, used.columnIndex + used.columnCount - 1)
          : expandFillDown(srcBox, used.rowIndex + used.rowCount - 1);
      dest = boxToA1(sheet, destBox);
    }
    dest.load("address");
    await context.sync();
    const fillMap: Record<string, Excel.AutoFillType> = {
      default: Excel.AutoFillType.fillDefault,
      copy: Excel.AutoFillType.fillCopy,
      series: Excel.AutoFillType.fillSeries,
      formats: Excel.AutoFillType.fillFormats,
      values: Excel.AutoFillType.fillValues,
    };
    source.autoFill(parseA1Range(dest.address), fillMap[fillType]);
    await context.sync();
    return {
      sheet: sheetName,
      source: parseA1Range(source.address),
      destination: parseA1Range(dest.address),
      fillType,
    };
  });
}
