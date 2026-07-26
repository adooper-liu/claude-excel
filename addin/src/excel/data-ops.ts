/// <reference types="@types/office-js" />

export async function applySortFilter(
  sheetName: string, rangeAddress: string, action: 'sort' | 'filter' | 'clearFilter',
  sortBy?: Array<{ column: string; order: string }>,
  _filterBy?: Array<{ column: string; operator: string; value: string }>,
): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(rangeAddress);

    if (action === 'sort' && sortBy) {
      const fields: Excel.SortField[] = sortBy.map(s => ({
        key: s.column.charCodeAt(0) - 65,
        sortOn: 'Value' as Excel.SortOn,
        ascending: s.order !== 'descending',
      }));
      range.sort.apply(fields, false, true);
      await context.sync();
    }

    if (action === 'filter' || action === 'clearFilter') {
      // Basic autoFilter toggle
      if (action === 'clearFilter') {
        (sheet.autoFilter as any).remove();
      } else {
        (sheet.autoFilter as any).apply(range);
      }
      await context.sync();
    }
  });
}
