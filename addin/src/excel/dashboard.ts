/// <reference types="@types/office-js" />

import { planDashboard } from "./dashboard-core";
import type { Cell, ChartKind, DashboardPlan, KpiKind } from "./dashboard-core";
import { parseA1Range, resolveTableName } from "./table-name";
import { createChart } from "./chart";
import { sheetHistory } from "./sheet-history";
import { nextSheetName } from "./sheet-name";
import { CHUNK_ROWS, FULL_LOAD_MAX_CELLS, chunkRanges } from "./range-chunk";

export type BuildDashboardOpts = {
  tableName?: string;
  sourceSheet?: string;
  sourceRange?: string;
  outputSheet?: string;
  valueColumns?: string[];
  countColumn?: string;
  dimensions?: string[];
  dateColumn?: string;
  kpis?: string[];
  charts?: string[];
  includeBestOf?: boolean;
};

type SourceData = {
  headers: string[];
  rows: Cell[][];
  tableName: string;
  sheet: string;
};

type Check = { cell: string; label: string; ok: (f: string) => boolean };

function splitCsv(v: unknown): string[] | undefined {
  if (Array.isArray(v)) return (v as string[]).map((s) => String(s).trim()).filter(Boolean);
  if (v == null || v === "") return undefined;
  return String(v).split(",").map((s) => s.trim()).filter(Boolean);
}

function columnIndex(headers: string[], name: string): number {
  const i = headers.indexOf(name);
  if (i < 0) throw new Error("仪表盘没有列「" + name + "」。现有列: " + headers.join("、"));
  return i;
}

function columnValues(headers: string[], rows: Cell[][], name: string): Cell[] {
  const i = columnIndex(headers, name);
  return rows.map((r) => (r[i] === null || r[i] === undefined ? null : (r[i] as Cell)));
}

async function readSource(
  context: Excel.RequestContext,
  opts: BuildDashboardOpts,
  sheetNames: string[],
  tableNames: string[]
): Promise<SourceData> {
  const tableName = String(opts.tableName || "").trim();
  if (tableName) {
    const resolved = resolveTableName(tableName, tableNames);
    const table = context.workbook.tables.getItem(resolved);
    const ws = table.worksheet;
    ws.load("name");
    table.load("name");
    table.rows.load("count");
    const header = table.getHeaderRowRange();
    header.load("values");
    await context.sync();
    const headers = (header.values[0] || []).map((c) => String(c ?? "").trim());
    const dataRows = table.rows.count;
    let rows: Cell[][] = [];
    if (dataRows > 0) {
      if (dataRows * headers.length > FULL_LOAD_MAX_CELLS) {
        throw new Error("源表 " + dataRows + " 行 " + headers.length + " 列超过一次载入上限，先提取需要的列");
      }
      const body = table.getDataBodyRange();
      for (const ch of chunkRanges(dataRows, CHUNK_ROWS)) {
        const chunk = body.getRow(ch.start).getBoundingRect(body.getRow(ch.start + ch.count - 1));
        chunk.load("values");
        await context.sync();
        rows = rows.concat(chunk.values as Cell[][]);
      }
    }
    return { headers, rows, tableName: table.name, sheet: ws.name };
  }
  const sheetName = String(opts.sourceSheet || "").trim() || sheetNames[0];
  if (!sheetName) throw new Error("没有工作表，无法做仪表盘");
  const sheet = context.workbook.worksheets.getItem(sheetName);
  const rangeAddr = String(opts.sourceRange || "").trim();
  const range = rangeAddr ? sheet.getRange(parseA1Range(rangeAddr)) : sheet.getUsedRangeOrNullObject();
  range.load(["values", "isNullObject"]);
  await context.sync();
  if ((range as Excel.Range & { isNullObject?: boolean }).isNullObject) {
    throw new Error("源区域是空的");
  }
  const values = (range.values as Cell[][]) || [];
  const cellCount = values.length && values[0] ? values.length * values[0].length : 0;
  if (cellCount > FULL_LOAD_MAX_CELLS) {
    throw new Error("源区域超过一次载入上限，先缩小范围或提取需要的列");
  }
  const headers = (values[0] || []).map((c) => String(c ?? "").trim());
  const rows = values.slice(1);
  return { headers, rows, tableName: "", sheet: sheetName };
}

function buildChecks(plan: DashboardPlan): Check[] {
  const checks: Check[] = [];
  for (const k of plan.report.kpi) {
    if (k.kind === "total") {
      checks.push({ cell: k.cell, label: "KPI 合计以 =SUM 开头", ok: (f) => f.indexOf("=SUM") === 0 });
    } else if (k.kind === "count") {
      checks.push({ cell: k.cell, label: "KPI 笔数以 =COUNTA 开头", ok: (f) => f.indexOf("=COUNTA") === 0 });
    } else if (k.kind === "avg") {
      checks.push({ cell: k.cell, label: "KPI 均值含 IFERROR 或 AVERAGE", ok: (f) => f.indexOf("IFERROR") >= 0 || f.indexOf("AVERAGE") >= 0 });
    }
  }
  for (const d of plan.report.dimensions) {
    for (const row of d.rows) {
      checks.push({ cell: row.totalCell, label: "维度行合计以 =SUMIFS 开头", ok: (f) => f.indexOf("=SUMIFS") === 0 });
      checks.push({ cell: row.shareCell, label: "占比含 $", ok: (f) => f.indexOf("$") >= 0 });
    }
    checks.push({ cell: d.totalRow.shareCell, label: "合计占比含 $", ok: (f) => f.indexOf("$") >= 0 });
    if (d.bestCell) {
      checks.push({
        cell: d.bestCell,
        label: "最佳值以 =INDEX 开头且含 MATCH",
        ok: (f) => f.indexOf("=INDEX") === 0 && f.indexOf("MATCH") >= 0,
      });
    }
  }
  if (plan.report.monthly) {
    checks.push({ cell: plan.report.monthly.totalCell, label: "月序合计以 =SUM 开头", ok: (f) => f.indexOf("=SUM") === 0 });
  }
  return checks;
}

export async function buildDashboard(opts: BuildDashboardOpts): Promise<{
  sheet: string;
  kpiCells: Record<string, string>;
  months: string[];
  invalidDateCount: number;
  dimensions: Array<{ dimension: string; rows: number; bestCell: string | null }>;
  charts: Array<{ kind: string; title: string; dataRange: string; labelRange: string | null; chartType: string }>;
  selfCheck: string;
}> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    const tables = context.workbook.tables;
    tables.load("items/name");
    await context.sync();
    const sheetNames = sheets.items.map((s) => s.name);
    const tableNames = tables.items.map((t) => t.name);

    const src = await readSource(context, opts, sheetNames, tableNames);
    const dims = splitCsv(opts.dimensions) || [];
    const dateCol = String(opts.dateColumn || "").trim() || undefined;
    const dimensionValues: Record<string, Cell[]> = {};
    for (const d of dims) dimensionValues[d] = columnValues(src.headers, src.rows, d);
    const dateValues = dateCol ? columnValues(src.headers, src.rows, dateCol) : [];

    const plan = planDashboard(src.headers, {
      tableName: src.tableName || undefined,
      sourceSheet: src.sheet,
      valueColumns: splitCsv(opts.valueColumns) || [],
      countColumn: String(opts.countColumn || "").trim() || undefined,
      dimensions: dims,
      dateColumn: dateCol,
      kpis: splitCsv(opts.kpis) as KpiKind[] | undefined,
      charts: splitCsv(opts.charts) as ChartKind[] | undefined,
      includeBestOf: opts.includeBestOf === undefined ? undefined : Boolean(opts.includeBestOf),
      dimensionValues,
      dateColumnValues: dateValues,
    });

    const outName = nextSheetName(String(opts.outputSheet || "仪表盘").trim() || "仪表盘", sheetNames);
    const dest = sheets.add(outName);
    dest.activate();
    const rows = plan.grid.length;
    const cols = plan.grid[0] ? plan.grid[0].length : 1;
    dest.getRangeByIndexes(0, 0, rows, cols).formulas = plan.grid as (string | number | boolean)[][];

    // Title bold + merged; KPI label row bold (existing format APIs, no new helpers)
    const titleRange = dest.getRangeByIndexes(0, 0, 1, cols);
    titleRange.merge();
    titleRange.format.font.bold = true;
    titleRange.format.font.size = 14;
    if (rows > 1) dest.getRangeByIndexes(1, 0, 1, cols).format.font.bold = true;

    // Charts reuse chart.ts createChart; stack them so multiple charts don't overlap
    for (const ch of plan.charts) {
      await createChart(outName, ch.dataRange, ch.chartType, ch.title, undefined, ch.labelRange);
    }
    if (plan.charts.length > 0) {
      await Excel.run(async (ctx2) => {
        const sheet2 = ctx2.workbook.worksheets.getItem(outName);
        sheet2.charts.load("count");
        await ctx2.sync();
        for (let i = 0; i < sheet2.charts.count; i++) {
          const top = 15 + i * 22;
          const bottom = 35 + i * 22;
          sheet2.charts.getItemAt(i).setPosition("A" + top, "H" + bottom);
        }
        await ctx2.sync();
      });
    }

    // Readback self-check against the plan's report anchors - never silent
    const checks = buildChecks(plan);
    const mismatches: string[] = [];
    for (const c of checks) {
      const cell = dest.getRange(c.cell);
      cell.load("formulas");
      await context.sync();
      const f = String((cell.formulas as (string | number | boolean)[][])[0][0] || "");
      if (!c.ok(f)) mismatches.push(c.cell + " 期望 " + c.label + "，实际 " + f);
    }
    if (mismatches.length > 0) {
      throw new Error("仪表盘写后自查失败：" + mismatches.join("；"));
    }

    sheetHistory.push(outName, sheetNames[0] || outName);

    const kpiCells: Record<string, string> = {};
    for (const k of plan.report.kpi) kpiCells[k.kind] = k.cell;

    return {
      sheet: outName,
      kpiCells,
      months: plan.report.months,
      invalidDateCount: plan.report.invalidDateCount,
      dimensions: plan.report.dimensions.map((d) => ({
        dimension: d.dimension,
        rows: d.rows.length,
        bestCell: d.bestCell || null,
      })),
      charts: plan.charts.map((c) => ({
        kind: c.kind,
        title: c.title,
        dataRange: c.dataRange,
        labelRange: c.labelRange || null,
        chartType: c.chartType,
      })),
      selfCheck: "passed",
    };
  });
}
