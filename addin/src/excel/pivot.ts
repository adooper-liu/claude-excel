/// <reference types="@types/office-js" />

import { parseA1Range, resolveTableName } from "./table-name";
import { planPivot, uniqueName, type PivotAgg } from "./pivot-core";
import { sheetHistory } from "./sheet-history";

const AGG: Record<PivotAgg, Excel.AggregationFunction> = {
  sum: Excel.AggregationFunction.sum,
  count: Excel.AggregationFunction.count,
  average: Excel.AggregationFunction.average,
  min: Excel.AggregationFunction.min,
  max: Excel.AggregationFunction.max,
};

export type CreatePivotOpts = {
  sourceSheet?: string;
  sourceRange?: string;
  tableName?: string;
  outputSheet?: string;
  rows?: string[];
  columns?: string[];
  values?: Array<{ field: string; aggregation?: string }>;
  filters?: string[];
};

export async function createPivot(opts: CreatePivotOpts): Promise<{
  sheet: string;
  pivot: string;
  rows: string[];
  columns: string[];
  values: Array<{ field: string; aggregation: string }>;
}> {
  const rowsIn = Array.isArray(opts.rows) ? opts.rows : splitCsv(opts.rows);
  const colsIn = Array.isArray(opts.columns) ? opts.columns : splitCsv(opts.columns);
  const filtersIn = Array.isArray(opts.filters) ? opts.filters : splitCsv(opts.filters);
  let valuesIn = opts.values;
  if (!valuesIn && (opts as { valueField?: string }).valueField) {
    valuesIn = [{
      field: String((opts as { valueField?: string }).valueField),
      aggregation: (opts as { aggregation?: string }).aggregation,
    }];
  }

  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();
    const sheetNames = sheets.items.map((s) => s.name);
    const tableNames = tables.items.map((t) => t.name);
    const outName = uniqueName(String(opts.outputSheet || "透视").trim() || "透视", sheetNames);
    const pivotName = uniqueName("Piv", tableNames.concat(sheetNames));

    let headers: string[] = [];
    let source: Excel.Range | Excel.Table;
    const tableName = String(opts.tableName || "").trim();
    if (tableName) {
      const resolved = resolveTableName(tableName, tableNames);
      const table = tables.getItem(resolved);
      const header = table.getHeaderRowRange();
      header.load("values");
      await context.sync();
      headers = (header.values[0] || []).map((c) => String(c ?? "").trim());
      source = table;
    } else {
      const sheetName = String(opts.sourceSheet || "").trim() || sheets.items[0]?.name;
      if (!sheetName) throw new Error("没有工作表，无法做透视");
      const sheet = sheets.getItem(sheetName);
      const rangeAddr = String(opts.sourceRange || "").trim();
      const range = rangeAddr ? sheet.getRange(parseA1Range(rangeAddr)) : sheet.getUsedRangeOrNullObject();
      range.load(["values", "address", "isNullObject"]);
      await context.sync();
      if ((range as Excel.Range & { isNullObject?: boolean }).isNullObject) {
        throw new Error("源区域是空的");
      }
      headers = ((range.values && range.values[0]) || []).map((c) => String(c ?? "").trim());
      source = range;
    }

    const plan = planPivot(headers, {
      rows: rowsIn,
      columns: colsIn,
      values: valuesIn,
      filters: filtersIn,
    });

    const dest = sheets.add(outName);
    dest.activate();
    const pivotTable = dest.pivotTables.add(pivotName, source, dest.getRange("A1"));
    for (const name of plan.rows) {
      pivotTable.rowHierarchies.add(pivotTable.hierarchies.getItem(name));
    }
    for (const name of plan.columns) {
      pivotTable.columnHierarchies.add(pivotTable.hierarchies.getItem(name));
    }
    for (const name of plan.filters) {
      pivotTable.filterHierarchies.add(pivotTable.hierarchies.getItem(name));
    }
    for (const v of plan.values) {
      const dh = pivotTable.dataHierarchies.add(pivotTable.hierarchies.getItem(v.field));
      dh.summarizeBy = AGG[v.aggregation];
    }
    await context.sync();
    const previous = sheetNames[0] || outName;
    sheetHistory.push(outName, previous);
    return {
      sheet: outName,
      pivot: pivotName,
      rows: plan.rows,
      columns: plan.columns,
      values: plan.values,
    };
  });
}

function splitCsv(v: unknown): string[] {
  if (Array.isArray(v)) return (v as string[]).map((s) => String(s).trim()).filter(Boolean);
  if (v == null || v === "") return [];
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}
