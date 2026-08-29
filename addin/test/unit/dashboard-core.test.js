require("ts-node/register/transpile-only");
const assert = require("assert");
const { planDashboard } = require("../../src/excel/dashboard-core");

function cellAt(grid, cell) {
  const col = cell.replace(/\d+$/, "");
  const row = Number(cell.match(/\d+$/)[0]) - 1;
  let colIdx = 0;
  for (let i = 0; i < col.length; i++) colIdx = colIdx * 26 + (col.charCodeAt(i) - 64);
  colIdx -= 1;
  return grid[row][colIdx];
}

const HEADERS = ["日期", "产品", "区域", "销售", "金额", "数量", "订单号"];
const PARAMS = {
  tableName: "T_订单",
  valueColumns: ["金额"],
  countColumn: "订单号",
  dimensions: ["产品", "区域"],
  dateColumn: "日期",
  kpis: ["total", "count", "avg"],
  charts: ["dimension-bar", "month-line", "dimension-pie"],
  includeBestOf: true,
  dimensionValues: {
    产品: ["甲", "乙", "甲", "丙"],
    区域: ["华东", "华北", "华东"],
  },
  dateColumnValues: [
    "2026-01-05",
    "2026-01-20",
    "2026-02-10",
    "2026-02-28",
    "2026-03-01",
    "",
    "not-a-date",
  ],
};

describe("dashboard-core", function () {
  it("emits live =SUM KPI totals, never precomputed numbers", function () {
    const plan = planDashboard(HEADERS, PARAMS);
    const total = plan.report.kpi.find(function (k) {
      return k.kind === "total";
    });
    const f = String(cellAt(plan.grid, total.cell));
    assert.ok(f.indexOf("=SUM") === 0, f);
    assert.ok(!/^[-0-9.]+$/.test(f));
    const count = plan.report.kpi.find(function (k) {
      return k.kind === "count";
    });
    assert.ok(String(cellAt(plan.grid, count.cell)).indexOf("=COUNTA") === 0);
  });

  it("writes =SUMIFS dimension rows with absolute-ref share cells", function () {
    const plan = planDashboard(HEADERS, PARAMS);
    const d0 = plan.report.dimensions[0];
    assert.ok(d0.rows.length >= 3);
    for (const row of d0.rows) {
      const total = String(cellAt(plan.grid, row.totalCell));
      assert.ok(total.indexOf("=SUMIFS") === 0, total);
      const share = String(cellAt(plan.grid, row.shareCell));
      assert.ok(share.indexOf("$") >= 0, share);
    }
  });

  it("emits best-of =INDEX/MATCH highlight", function () {
    const plan = planDashboard(HEADERS, PARAMS);
    const d0 = plan.report.dimensions[0];
    assert.ok(d0.bestCell);
    const best = String(cellAt(plan.grid, d0.bestCell));
    assert.ok(best.indexOf("=INDEX") === 0, best);
    assert.ok(best.indexOf("MATCH") >= 0, best);
  });

  it("derives the month series from the real data span", function () {
    const plan = planDashboard(HEADERS, PARAMS);
    assert.deepStrictEqual(plan.report.months, ["2026-01", "2026-02", "2026-03"]);
    assert.strictEqual(plan.report.monthly.rows.length, 3);
    assert.strictEqual(plan.report.invalidDateCount, 2);
  });

  it("throws with an existing-columns list when a column is missing", function () {
    assert.throws(
      function () {
        planDashboard(HEADERS, Object.assign({}, PARAMS, { dimensions: ["不存在的维度"] }));
      },
      /现有列/
    );
  });

  it("is deterministic: same input yields the same grid", function () {
    const a = planDashboard(HEADERS, PARAMS);
    const b = planDashboard(HEADERS, PARAMS);
    assert.deepStrictEqual(a.grid, b.grid);
  });

  it("supports sheet-based sources with $A row refs", function () {
    const plan = planDashboard(["类别", "金额"], {
      sourceSheet: "流水",
      valueColumns: ["金额"],
      dimensions: ["类别"],
      dimensionValues: { 类别: ["食品", "饮料"] },
      includeBestOf: false,
      charts: [],
    });
    const d0 = plan.report.dimensions[0];
    const total = String(cellAt(plan.grid, d0.rows[0].totalCell));
    assert.ok(total.indexOf("=SUMIFS('流水'!") === 0, total);
    assert.ok(total.indexOf("$A") >= 0, total);
  });

  it("skips the monthly section when no valid dates parse", function () {
    const plan = planDashboard(HEADERS, Object.assign({}, PARAMS, {
      dateColumnValues: ["", "not-a-date", null],
    }));
    assert.strictEqual(plan.report.monthly, null);
  });

  it("labels a value-column fallback count as 记录数 not 笔数", function () {
    const plan = planDashboard(HEADERS, {
      tableName: "T_订单",
      valueColumns: ["金额"],
      kpis: ["total", "count"],
    });
    const count = plan.report.kpi.find(function (k) {
      return k.kind === "count";
    });
    assert.strictEqual(count.label, "记录数");
  });
});
