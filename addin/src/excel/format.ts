/// <reference types="@types/office-js" />

export async function formatRange(sheetName: string, address: string, fmt: {
  bold?: boolean; color?: string; bgColor?: string; numberFormat?: string; fontSize?: number; columnWidth?: number;
}): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    range.load('columnIndex');
    await context.sync();
    if (fmt.bold !== undefined) range.format.font.bold = fmt.bold;
    if (fmt.color) range.format.font.color = fmt.color;
    if (fmt.bgColor) range.format.fill.color = fmt.bgColor;
    if (fmt.numberFormat) range.numberFormat = [[fmt.numberFormat]];
    if (fmt.fontSize) range.format.font.size = fmt.fontSize;
    if (fmt.columnWidth) sheet.getRangeByIndexes(0, range.columnIndex, 1, 1).format.columnWidth = fmt.columnWidth;
    await context.sync();
  });
}

export async function addConditionalFormat(
  sheetName: string, address: string, type: string, options?: Record<string, unknown>,
): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    const fill = (options?.fillColor as string) || '#F8696B';

    switch (type) {
      case 'dataBar': {
        // Basic data bar — Office.js type defs are incomplete, use any
        const preset: any = range.conditionalFormats.add(Excel.ConditionalFormatType.dataBar);
        if (options?.barColor) preset.dataBar.barColor.color = options.barColor as string;
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
