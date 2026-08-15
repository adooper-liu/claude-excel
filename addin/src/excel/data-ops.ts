/// <reference types="@types/office-js" />

import { parseA1Range } from "./table-name";
import { columnKeyToIndex, mapFilterOperator } from "./filter-core";

export type SortSpec = { column: string; order?: string };
export type FilterSpec = { column: string; operator: string; value?: string; value2?: string };

export type SortFilterResult = {
  action: string;
  sheet: string;
  range: string;
  sortBy?: SortSpec[];
  filters?: FilterSpec[];
};

function officeCriteria(spec: ReturnType<typeof mapFilterOperator>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    filterOn: spec.filterOn === "values" ? "Values" : "Custom",
    criterion1: spec.criterion1,
  };
  if (spec.criterion2) out.criterion2 = spec.criterion2;
  if (spec.operator) out.operator = spec.operator;
  if (spec.values) out.values = spec.values;
  return out;
}

function applyOneFilter(autoFilter: Excel.AutoFilter, range: Excel.Range, colIndex: number, criteria: Record<string, unknown>): void {
  const af = autoFilter as Excel.AutoFilter & {
    getColumn?: (i: number) => { apply: (c: unknown) => void };
    apply: (r: Excel.Range, i?: number, c?: unknown) => void;
  };
  if (typeof af.getColumn === "function") {
    af.getColumn(colIndex).apply(criteria);
    return;
  }
  af.apply(range, colIndex, criteria);
}

export async function applySortFilter(
  sheetName: string,
  rangeAddress: string,
  action: "sort" | "filter" | "clearFilter",
  sortBy?: SortSpec[],
  filterBy?: FilterSpec[]
): Promise<SortFilterResult> {
  const address = parseA1Range(rangeAddress);
  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const range = sheet.getRange(address);
    range.load(["columnIndex", "columnCount", "rowCount"]);
    const header = range.getRow(0);
    header.load("values");
    await context.sync();
    const headers = ((header.values && header.values[0]) || []).map(function (c) {
      return String(c ?? "").trim();
    });
    const startCol = range.columnIndex;
    const result: SortFilterResult = { action, sheet: sheetName, range: address };

    if (action === "sort") {
      const specs = Array.isArray(sortBy) ? sortBy : [];
      if (specs.length === 0) throw new Error("sort 需要 sortBy，例如 [{column:'金额',order:'descending'}]");
      const fields: Excel.SortField[] = specs.map(function (s) {
        const key = columnKeyToIndex(s.column, headers, startCol);
        if (key >= range.columnCount) throw new Error('列 "' + s.column + '" 超出区域');
        return {
          key,
          sortOn: "Value" as Excel.SortOn,
          ascending: String(s.order || "").toLowerCase() !== "descending",
        };
      });
      range.sort.apply(fields, false, true);
      result.sortBy = specs;
      await context.sync();
      return result;
    }

    const autoFilter = sheet.autoFilter;
    if (action === "clearFilter") {
      autoFilter.remove();
      await context.sync();
      return result;
    }

    const filters = Array.isArray(filterBy) ? filterBy : [];
    autoFilter.apply(range);
    await context.sync();
    for (let i = 0; i < filters.length; i++) {
      const f = filters[i];
      const colIndex = columnKeyToIndex(f.column, headers, startCol);
      if (colIndex >= range.columnCount) throw new Error('列 "' + f.column + '" 超出区域');
      const criteria = officeCriteria(mapFilterOperator(f.operator, f.value, f.value2));
      applyOneFilter(autoFilter, range, colIndex, criteria);
    }
    result.filters = filters;
    await context.sync();
    return result;
  });
}
