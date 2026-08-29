/** Pure dashboard layout - emit live Excel formulas, never precomputed aggregates. No Office JS. */

import {
  colIndexToLetter,
  quoteSheetName,
  structCol,
  sumifsFormulaMulti,
  sumifsFormulaSheetMulti,
} from "./calculate-core";
import { dayToIso, parseDateCell } from "./date-cell";

export type Cell = string | number | boolean | null;
export type KpiKind = "total" | "count" | "avg";
export type ChartKind = "dimension-bar" | "month-line" | "dimension-pie";

export type DashboardParams = {
  tableName?: string;
  sourceSheet?: string;
  valueColumns: string[];
  countColumn?: string;
  dimensions?: string[];
  dateColumn?: string;
  kpis?: KpiKind[];
  charts?: ChartKind[];
  includeBestOf?: boolean;
  /** Raw column values per dimension, read by the Office JS layer (never sent to the model). */
  dimensionValues?: Record<string, Cell[]>;
  /** Raw date column values, read by the Office JS layer, used to derive the real month span. */
  dateColumnValues?: Cell[];
};

export type KpiRef = {
  kind: KpiKind;
  label: string;
  cell: string;
  formula: string;
  column?: string;
};

export type DimensionRowRef = {
  labelCell: string;
  totalCell: string;
  shareCell: string;
};

export type DimensionSection = {
  dimension: string;
  titleCell: string;
  headerCell: string;
  rows: DimensionRowRef[];
  totalRow: DimensionRowRef;
  bestCell?: string;
  labelRange: string;
  dataRange: string;
};

export type MonthlySection = {
  headerCell: string;
  rows: Array<{ labelCell: string; totalCell: string }>;
  totalCell: string;
  labelRange: string;
  dataRange: string;
};

export type DashboardChartSpec = {
  kind: ChartKind;
  chartType: string;
  title: string;
  dataRange: string;
  labelRange?: string;
};

export type DashboardPlan = {
  grid: Cell[][];
  charts: DashboardChartSpec[];
  report: {
    titleCell: string;
    kpi: KpiRef[];
    monthly: MonthlySection | null;
    dimensions: DimensionSection[];
    months: string[];
    invalidDateCount: number;
  };
};

const KPI_ORDER: KpiKind[] = ["total", "count", "avg"];
const CHART_KINDS: ChartKind[] = ["dimension-bar", "month-line", "dimension-pie"];
const TITLE = "仪表盘";

function splitNames(raw: string[] | undefined): string[] {
  return (raw || []).map((s) => String(s || "").trim()).filter(Boolean);
}

function requireColumn(headers: string[], name: string): number {
  const idx = headers.indexOf(name);
  if (idx < 0) {
    throw new Error("仪表盘没有列「" + name + "」。现有列: " + (headers.join("、") || "(无)"));
  }
  return idx;
}

/** 0-based row/col -> A1 (e.g. row 2, col 0 -> "A3"). */
function a1(row: number, col: number): string {
  return colIndexToLetter(col) + (row + 1);
}

/** "A3" -> "$A$3". */
function absA1(cell: string): string {
  const m = cell.match(/^([A-Z]+)(\d+)$/);
  if (!m) return "$" + cell;
  return "$" + m[1] + "$" + m[2];
}

function absCell(row: number, col: number): string {
  return "$" + colIndexToLetter(col) + "$" + (row + 1);
}

function fillRow(width: number, value: Cell): Cell[] {
  const out: Cell[] = [];
  for (let i = 0; i < width; i++) out.push(value);
  return out;
}

function totalFormula(
  tableName: string | undefined,
  sourceSheet: string | undefined,
  colName: string,
  colIdx: number
): string {
  if (tableName) return "=SUM(" + structCol(tableName, colName) + ")";
  const sheet = quoteSheetName(sourceSheet || "");
  const letter = colIndexToLetter(colIdx);
  return "=SUM(" + sheet + "!" + letter + ":" + letter + ")";
}

function countFormula(
  tableName: string | undefined,
  sourceSheet: string | undefined,
  colName: string,
  colIdx: number
): string {
  if (tableName) return "=COUNTA(" + structCol(tableName, colName) + ")";
  const sheet = quoteSheetName(sourceSheet || "");
  const letter = colIndexToLetter(colIdx);
  return "=COUNTA(" + sheet + "!" + letter + ":" + letter + ")";
}

function averageFormula(
  tableName: string | undefined,
  sourceSheet: string | undefined,
  colName: string,
  colIdx: number
): string {
  if (tableName) return "=AVERAGE(" + structCol(tableName, colName) + ")";
  const sheet = quoteSheetName(sourceSheet || "");
  const letter = colIndexToLetter(colIdx);
  return "=AVERAGE(" + sheet + "!" + letter + ":" + letter + ")";
}

/** Sum of one source column filtered by this row's dimension label cell (e.g. $A6). */
function rowSumFormula(
  tableName: string | undefined,
  sourceSheet: string | undefined,
  valueCol: string,
  valueIdx: number,
  dimCol: string,
  dimIdx: number,
  labelCell: string
): string {
  const criteriaRef = "$" + labelCell;
  if (tableName) {
    return sumifsFormulaMulti(tableName, valueCol, [{ column: dimCol, criteriaRef }]);
  }
  return sumifsFormulaSheetMulti(sourceSheet || "", colIndexToLetter(valueIdx), [
    { colLetter: colIndexToLetter(dimIdx), criteriaA1: criteriaRef },
  ]);
}

/** ">="&DATE(2026,1,1) / "<"&DATE(2026,2,1) criteria pair for a month label "2026-01". */
function monthCriteria(m: string): { start: string; end: string } {
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  return {
    start: '">="&DATE(' + y + "," + mo + ",1)",
    end: '"<"&DATE(' + ny + "," + nm + ",1)",
  };
}

function monthSumFormula(
  tableName: string | undefined,
  sourceSheet: string | undefined,
  valueCol: string,
  valueIdx: number,
  dateCol: string,
  dateIdx: number,
  m: string
): string {
  const c = monthCriteria(m);
  if (tableName) {
    return sumifsFormulaMulti(tableName, valueCol, [
      { column: dateCol, criteriaRef: c.start },
      { column: dateCol, criteriaRef: c.end },
    ]);
  }
  return sumifsFormulaSheetMulti(sourceSheet || "", colIndexToLetter(valueIdx), [
    { colLetter: colIndexToLetter(dateIdx), criteriaA1: c.start },
    { colLetter: colIndexToLetter(dateIdx), criteriaA1: c.end },
  ]);
}

function shareFormula(rowTotalCell: string, denomAbs: string): string {
  return "=IFERROR($" + rowTotalCell + "/" + denomAbs + ",0)";
}

function sumRangeFormula(letter: string, startRow: number, endRow: number): string {
  return "=SUM(" + letter + (startRow + 1) + ":" + letter + (endRow + 1) + ")";
}

function indexBestFormula(labelLetter: string, totalLetter: string, startRow: number, endRow: number): string {
  return (
    "=INDEX(" +
    labelLetter +
    (startRow + 1) +
    ":" +
    labelLetter +
    (endRow + 1) +
    ",MATCH(MAX(" +
    totalLetter +
    (startRow + 1) +
    ":" +
    totalLetter +
    (endRow + 1) +
    ")," +
    totalLetter +
    (startRow + 1) +
    ":" +
    totalLetter +
    (endRow + 1) +
    ",0))"
  );
}

function uniqueLabels(values: Cell[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values || []) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out.sort();
}

export function planDashboard(headers: string[], params: DashboardParams): DashboardPlan {
  const heads = (headers || []).map((h) => String(h || "").trim()).filter(Boolean);
  if (heads.length === 0) throw new Error("没有表头，无法铺仪表盘");

  const valueColumns = splitNames(params.valueColumns);
  if (valueColumns.length === 0) {
    throw new Error("请指定 valueColumns（数值列，如 金额）。现有列: " + (heads.join("、") || "(无)"));
  }
  const valueIdx = valueColumns.map((vc) => requireColumn(heads, vc));

  const dims = splitNames(params.dimensions);
  dims.forEach((d) => requireColumn(heads, d));

  let countColumn = String(params.countColumn || "").trim();
  let countLabel = "笔数";
  if (!countColumn) {
    countColumn = dims[0] || valueColumns[0];
    if (!dims[0]) countLabel = "记录数";
  }
  const countIdx = requireColumn(heads, countColumn);

  const dateColumn = String(params.dateColumn || "").trim();
  const dateIdx = dateColumn ? requireColumn(heads, dateColumn) : -1;

  const kpisRaw = splitNames(params.kpis as string[] | undefined);
  const kpis: KpiKind[] = kpisRaw.length
    ? (kpisRaw.filter((k) => KPI_ORDER.indexOf(k as KpiKind) >= 0) as KpiKind[])
    : KPI_ORDER.slice();
  if (kpis.length === 0) throw new Error("kpis 只能是 total|count|avg");

  const chartKindsRaw = splitNames(params.charts as string[] | undefined);
  const chartKinds: ChartKind[] = [];
  if (chartKindsRaw.length) {
    for (const k of chartKindsRaw) {
      if (CHART_KINDS.indexOf(k as ChartKind) >= 0 && chartKinds.indexOf(k as ChartKind) < 0) {
        chartKinds.push(k as ChartKind);
      }
    }
  } else {
    if (dims.length) chartKinds.push("dimension-bar");
    if (dateColumn) chartKinds.push("month-line");
  }

  const tableName = String(params.tableName || "").trim() || undefined;
  const sourceSheet = String(params.sourceSheet || "").trim() || undefined;
  if (!tableName && !sourceSheet) {
    throw new Error("需要 tableName 或 sourceSheet（仪表盘公式要引用源表）");
  }

  const includeBestOf = params.includeBestOf === false ? false : true;

  // ---- KPI cards: labels on 0-based row 1, values on row 2 ----
  const kpi: KpiRef[] = [];
  let col = 0;
  for (let i = 0; i < valueColumns.length; i++) {
    const vc = valueColumns[i];
    kpi.push({
      kind: "total",
      label: vc + "合计",
      cell: a1(2, col),
      formula: totalFormula(tableName, sourceSheet, vc, valueIdx[i]),
      column: vc,
    });
    col++;
  }
  if (kpis.indexOf("count") >= 0) {
    kpi.push({
      kind: "count",
      label: countLabel,
      cell: a1(2, col),
      formula: countFormula(tableName, sourceSheet, countColumn, countIdx),
      column: countColumn,
    });
    col++;
  }
  if (kpis.indexOf("avg") >= 0) {
    const total = kpi.find((k) => k.kind === "total");
    const count = kpi.find((k) => k.kind === "count");
    const formula =
      total && count
        ? "=IFERROR(" + absA1(total.cell) + "/" + absA1(count.cell) + ",0)"
        : averageFormula(tableName, sourceSheet, valueColumns[0], valueIdx[0]);
    kpi.push({ kind: "avg", label: "均值", cell: a1(2, col), formula });
    col++;
  }

  const totalKpi = kpi.find((k) => k.kind === "total");
  const kpiTotalAbs = totalKpi ? absA1(totalKpi.cell) : null;

  const width = Math.max(kpi.length, dateColumn ? 2 : 0, dims.length ? 3 : 0, 1);
  const grid: Cell[][] = [];
  let r = 0;

  // Title
  grid.push(([TITLE] as Cell[]).concat(fillRow(width - 1, "")));
  r = 1;
  grid.push((kpi.map((k) => k.label) as Cell[]).concat(fillRow(width - kpi.length, "")));
  r = 2;
  grid.push((kpi.map((k) => k.formula) as Cell[]).concat(fillRow(width - kpi.length, "")));
  r = 3;
  grid.push(fillRow(width, ""));
  r = 4;

  // Month series derived from the real min/max of the date column values
  const months: string[] = [];
  let invalidDateCount = 0;
  if (dateColumn) {
    const seen = new Set<string>();
    for (const v of params.dateColumnValues || []) {
      const day = parseDateCell(v);
      if (day === null) {
        invalidDateCount++;
        continue;
      }
      seen.add(dayToIso(day).slice(0, 7));
    }
    months.push(...Array.from(seen).sort());
  }

  let monthly: MonthlySection | null = null;
  if (dateColumn && months.length > 0) {
    grid.push((["月度营收"] as Cell[]).concat(fillRow(width - 1, "")));
    r = 5;
    grid.push((["月份", "合计"] as Cell[]).concat(fillRow(width - 2, "")));
    r = 6;
    const monthStart = r;
    const monthRows: MonthlySection["rows"] = [];
    for (const m of months) {
      grid.push([
        m,
        monthSumFormula(tableName, sourceSheet, valueColumns[0], valueIdx[0], dateColumn, dateIdx, m),
      ]);
      monthRows.push({ labelCell: a1(r, 0), totalCell: a1(r, 1) });
      r++;
    }
    const monthEnd = r - 1;
    const monthTotalCell = a1(r, 1);
    grid.push(["合计", sumRangeFormula("B", monthStart, monthEnd)]);
    r++;
    monthly = {
      headerCell: a1(5, 0),
      rows: monthRows,
      totalCell: monthTotalCell,
      labelRange: months.length ? "A" + (monthStart + 1) + ":A" + (monthEnd + 1) : "",
      dataRange: months.length ? "B" + (monthStart + 1) + ":B" + (monthEnd + 1) : "",
    };
    grid.push(fillRow(width, ""));
    r++;
  }

  // One SUMIFS table per dimension
  const dimensions: DimensionSection[] = [];
  for (const d of dims) {
    grid.push((["按" + d] as Cell[]).concat(fillRow(width - 1, "")));
    r++;
    grid.push(([d, "合计", "占比"] as Cell[]).concat(fillRow(width - 3, "")));
    r++;
    const dimStart = r;
    const dimIdx = heads.indexOf(d);
    const labels = uniqueLabels((params.dimensionValues || {})[d]);
    const totalRowRow = dimStart + labels.length;
    const denomAbs = kpiTotalAbs || absCell(totalRowRow, 1);
    const dimRows: DimensionRowRef[] = [];
    for (const label of labels) {
      const labelCell = a1(r, 0);
      const totalCell = a1(r, 1);
      const shareCell = a1(r, 2);
      grid.push([
        label,
        rowSumFormula(tableName, sourceSheet, valueColumns[0], valueIdx[0], d, dimIdx, labelCell),
        shareFormula(totalCell, denomAbs),
      ]);
      dimRows.push({ labelCell, totalCell, shareCell });
      r++;
    }
    const dimEnd = r - 1;
    const totalLabelCell = a1(r, 0);
    const totalTotalCell = a1(r, 1);
    const totalShareCell = a1(r, 2);
    grid.push([
      "合计",
      sumRangeFormula("B", dimStart, dimEnd),
      shareFormula(totalTotalCell, denomAbs),
    ]);
    r++;
    let bestCell: string | undefined;
    if (includeBestOf && labels.length > 0) {
      bestCell = a1(r, 1);
      grid.push(["最佳" + d, indexBestFormula("A", "B", dimStart, dimEnd)]);
      r++;
    }
    dimensions.push({
      dimension: d,
      titleCell: a1(dimStart - 2, 0),
      headerCell: a1(dimStart - 1, 0),
      rows: dimRows,
      totalRow: { labelCell: totalLabelCell, totalCell: totalTotalCell, shareCell: totalShareCell },
      bestCell,
      labelRange: labels.length ? "A" + (dimStart + 1) + ":A" + (dimEnd + 1) : "",
      dataRange: labels.length ? "B" + (dimStart + 1) + ":B" + (dimEnd + 1) : "",
    });
    grid.push(fillRow(width, ""));
    r++;
  }

  // Charts use the exact coordinates computed above
  const charts: DashboardChartSpec[] = [];
  for (const kind of chartKinds) {
    if (kind === "dimension-bar" || kind === "dimension-pie") {
      const d0 = dimensions[0];
      if (!d0 || !d0.dataRange) continue;
      charts.push({
        kind,
        chartType: kind === "dimension-bar" ? "ColumnClustered" : "Pie",
        title: "按" + d0.dimension + (kind === "dimension-bar" ? "合计" : "占比"),
        dataRange: d0.dataRange,
        labelRange: d0.labelRange,
      });
    } else if (kind === "month-line") {
      if (!monthly || !monthly.dataRange) continue;
      charts.push({
        kind,
        chartType: "Line",
        title: "月度趋势",
        dataRange: monthly.dataRange,
        labelRange: monthly.labelRange,
      });
    }
  }

  return {
    grid,
    charts,
    report: {
      titleCell: "A1",
      kpi,
      monthly,
      dimensions,
      months,
      invalidDateCount,
    },
  };
}
