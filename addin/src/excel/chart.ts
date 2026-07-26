/// <reference types="@types/office-js" />

export async function createChart(sheetName: string, dataRange: string, chartType: string, title: string, seriesBy?: string, labelRange?: string): Promise<void> {
  await Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(dataRange);
    const by = (seriesBy === 'rows' ? 'Rows' : 'Columns') as Excel.ChartSeriesBy;
    const chart = sheet.charts.add(chartType as Excel.ChartType, range, by);
    chart.title.text = title;
    if (labelRange) chart.series.getItemAt(0).setXAxisValues(sheet.getRange(labelRange));
    chart.legend.position = 'Bottom' as Excel.ChartLegendPosition;
    chart.setPosition('A15', 'H35');
    await context.sync();
  });
}
