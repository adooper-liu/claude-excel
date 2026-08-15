/// <reference types="@types/office-js" />

import { parseA1Range } from "./table-name";
import { freezeAtCell, type FormatOpts } from "./format-core";

const BORDER_EDGES: Excel.BorderIndex[] = [
  "EdgeTop" as Excel.BorderIndex,
  "EdgeBottom" as Excel.BorderIndex,
  "EdgeLeft" as Excel.BorderIndex,
  "EdgeRight" as Excel.BorderIndex,
  "InsideHorizontal" as Excel.BorderIndex,
  "InsideVertical" as Excel.BorderIndex,
];

function applyBorder(range: Excel.Range, border: FormatOpts["border"], color?: string): void {
  if (!border) return;
  for (let i = 0; i < BORDER_EDGES.length; i++) {
    const b = range.format.borders.getItem(BORDER_EDGES[i]);
    if (border === "none") {
      b.style = "None" as Excel.BorderLineStyle;
      continue;
    }
    b.style = "Continuous" as Excel.BorderLineStyle;
    b.weight = border as Excel.BorderWeight;
    if (color) b.color = color;
  }
}

function applyFreeze(sheet: Excel.Worksheet, fmt: FormatOpts): void {
  const at = freezeAtCell(fmt.freezeRows, fmt.freezeCols);
  if (at === undefined) return;
  if (at === null) {
    sheet.freezePanes.unfreeze();
    return;
  }
  if (at.col === 0) {
    sheet.freezePanes.freezeRows(at.row);
    return;
  }
  if (at.row === 0) {
    sheet.freezePanes.freezeColumns(at.col);
    return;
  }
  sheet.freezePanes.freezeAt(sheet.getRangeByIndexes(at.row, at.col, 1, 1));
}

export async function formatRange(sheetName: string, address: string, fmt: FormatOpts): Promise<{ sheet: string; range: string }> {
  const a1 = parseA1Range(address);
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(a1);
    range.load("columnIndex");
    await context.sync();
    if (fmt.bold !== undefined) range.format.font.bold = fmt.bold;
    if (fmt.color) range.format.font.color = fmt.color;
    if (fmt.bgColor) range.format.fill.color = fmt.bgColor;
    if (fmt.numberFormat) range.numberFormat = [[fmt.numberFormat]];
    if (fmt.fontSize) range.format.font.size = fmt.fontSize;
    if (fmt.columnWidth) sheet.getRangeByIndexes(0, range.columnIndex, 1, 1).format.columnWidth = fmt.columnWidth;
    if (fmt.hAlign) range.format.horizontalAlignment = fmt.hAlign as Excel.HorizontalAlignment;
    if (fmt.vAlign) range.format.verticalAlignment = fmt.vAlign as Excel.VerticalAlignment;
    if (fmt.wrap !== undefined) range.format.wrapText = fmt.wrap;
    if (fmt.rowHeight != null) range.format.rowHeight = fmt.rowHeight;
    applyBorder(range, fmt.border, fmt.borderColor);
    if (fmt.autoFit) range.format.autofitColumns();
    applyFreeze(sheet, fmt);
    await context.sync();
  });
  return { sheet: sheetName, range: a1 };
}

export async function addConditionalFormat(
  sheetName: string, address: string, type: string, options?: Record<string, unknown>,
): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(parseA1Range(address));
    const fill = (options?.fillColor as string) || '#F8696B';

    switch (type) {
      case 'dataBar': {
        const preset: Excel.ConditionalFormat = range.conditionalFormats.add(Excel.ConditionalFormatType.dataBar);
        if (options?.barColor) (preset as Excel.ConditionalFormat & { dataBar: { barColor: { color: string } } }).dataBar.barColor.color = options.barColor as string;
        break;
      }
      case 'colorScale': {
        const cs: any = range.conditionalFormats.add(Excel.ConditionalFormatType.colorScale);
        cs.colorScale.criteria[0].format.fill.color = (options?.minColor as string) || '#F8696B';
        cs.colorScale.criteria[1].format.fill.color = (options?.maxColor as string) || '#63BE7B';
        break;
      }
      case 'iconSet': {
        const iset: any = range.conditionalFormats.add(Excel.ConditionalFormatType.iconSet);
        iset.iconSet.style = (options?.iconStyle as string) || 'ThreeArrows';
        break;
      }
      case 'cellValue': {
        const cv: any = range.conditionalFormats.add(Excel.ConditionalFormatType.cellValue);
        cv.cellValue.format.fill.color = fill;
        cv.cellValue.rule.formula1 = (options?.compareTo as string) || '0';
        cv.cellValue.rule.operator = ((options?.operator as string) || 'GreaterThan');
        break;
      }
      case 'topBottom': {
        const tb: any = range.conditionalFormats.add(Excel.ConditionalFormatType.topBottom);
        tb.topBottom.format.fill.color = fill;
        tb.topBottom.rule.rank = (options?.rank as number) || 10;
        tb.topBottom.rule.top = ((options?.top as boolean) ?? true);
        break;
      }
    }
    await context.sync();
  });
}
