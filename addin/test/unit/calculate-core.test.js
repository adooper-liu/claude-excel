require("ts-node/register/transpile-only");
const assert = require("assert");
const { calculate, fixRefFormula } = require("../../src/excel/calculate-core");

describe("calculate-core", function () {
  it("writes INDEX/MATCH formulas instead of looked-up values", function () {
    const result = calculate({
      op: "lookup",
      leftTable: "T_订单",
      rightTable: "T_流水",
      leftHeaders: ["订单号", "客户"],
      leftRows: [
        ["A", "张"],
        ["B", "李"],
      ],
      rightHeaders: ["订单号", "金额"],
      key: "订单号",
      bringColumns: ["金额"],
    });
    assert.deepStrictEqual(result.headers, ["订单号", "客户", "金额"]);
    assert.strictEqual(result.rows[0][0], "A");
    assert.strictEqual(
      result.rows[0][2],
      "=IFERROR(INDEX('T_流水'[[金额]],MATCH([@[订单号]],'T_流水'[[订单号]],0)),\"\")"
    );
    assert.ok(String(result.rows[0][2]).startsWith("="));
    assert.ok(!/XLOOKUP|VLOOKUP/i.test(String(result.rows[0][2])));
    assert.ok(!/10|20/.test(JSON.stringify(result.rows)));
  });

  it("writes SUMIFS formulas for unique groups, not precomputed totals", function () {
    const result = calculate({
      op: "sumifs",
      tableName: "T_订单",
      headers: ["类别", "金额"],
      rows: [
        ["食品", 10],
        ["食品", 5],
        ["饮料", 8],
      ],
      groupBy: "类别",
      valueColumn: "金额",
    });
    assert.deepStrictEqual(result.headers, ["类别", "合计"]);
    assert.deepStrictEqual(
      result.rows.map(function (r) {
        return r[0];
      }),
      ["食品", "饮料"]
    );
    assert.strictEqual(result.rows[0][1], "=SUMIFS('T_订单'[[金额]],'T_订单'[[类别]],[@[类别]])");
    assert.ok(result.rows[0][1] !== 15);
  });

  it("sumifs supports multi groupBy and fixed criteria", function () {
    const result = calculate({
      op: "sumifs_multi",
      tableName: "T_订单",
      headers: ["sku", "month", "channel", "amount"],
      rows: [
        ["a", "01", "web", 10],
        ["a", "01", "web", 5],
        ["a", "02", "web", 3],
        ["b", "01", "store", 8],
      ],
      groupBy: ["sku", "month"],
      valueColumn: "amount",
      criteria: [{ column: "channel", value: "web" }],
    });
    assert.deepStrictEqual(result.headers, ["sku", "month", "合计"]);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(
      result.rows[0][2],
      '=SUMIFS(\'T_订单\'[amount],\'T_订单\'[sku],[@sku],\'T_订单\'[month],[@month],\'T_订单\'[channel],"web")'
    );
  });

  it("sumifs throws when criteria column missing", function () {
    assert.throws(function () {
      calculate({
        op: "sumifs",
        tableName: "T",
        headers: ["a", "b"],
        rows: [["x", 1]],
        groupBy: "a",
        valueColumn: "b",
        criteria: [{ column: "nope", value: 1 }],
      });
    }, /nope/);
  });

  it("arithmetic writes declarative row formulas", function () {
    const result = calculate({
      op: "arithmetic",
      tableName: "T_利润",
      headers: ["收入", "佣金", "广告"],
      rows: [
        [100, 15, 10],
        [200, 30, 20],
      ],
      outputColumn: "净利",
      expression: {
        terms: [
          { column: "收入" },
          { op: "-", column: "佣金" },
          { op: "-", column: "广告" },
        ],
      },
    });
    assert.deepStrictEqual(result.headers, ["收入", "佣金", "广告", "净利"]);
    assert.strictEqual(result.rows[0][3], "=[@[收入]]-[@[佣金]]-[@[广告]]");
    assert.strictEqual(result.rows[1][3], result.rows[0][3]);
  });

  it("arithmetic rejects free-form mixed term fields", function () {
    assert.throws(function () {
      calculate({
        op: "arithmetic",
        tableName: "T",
        headers: ["a"],
        rows: [[1]],
        expression: { terms: [{ column: "a", literal: 1 }] },
      });
    }, /之一/);
  });

  it("conditional_column writes IF formulas", function () {
    const result = calculate({
      op: "conditional_column",
      tableName: "T",
      headers: ["净利率"],
      rows: [[0.05], [0.2]],
      column: "净利率",
      operator: "lt",
      value: 0.1,
      outputColumn: "风险",
      trueExpr: { literal: "高风险" },
      falseExpr: { literal: "正常" },
    });
    assert.strictEqual(result.rows[0][1], '=IF([@[净利率]]<0.1,"高风险","正常")');
  });

  it("conditional_column between needs valueTo", function () {
    assert.throws(function () {
      calculate({
        op: "conditional_column",
        tableName: "T",
        headers: ["x"],
        rows: [[1]],
        column: "x",
        operator: "between",
        value: 1,
        trueExpr: { literal: 1 },
        falseExpr: { literal: 0 },
      });
    }, /valueTo/);
  });

  it("writes sheet-based SUMIFS when sourceSheet is set", function () {
    const result = calculate({
      op: "sumifs",
      tableName: "T_finance_recon",
      sourceSheet: "业财对账结果",
      headers: ["left_platform_sku", "left_item_price"],
      rows: [
        ["widget-a", 19.99],
        ["widget-b", 15],
      ],
      groupBy: "left_platform_sku",
      valueColumn: "left_item_price",
    });
    assert.strictEqual(
      result.rows[0][1],
      "=SUMIFS('业财对账结果'!B:B,'业财对账结果'!A:A,A2)"
    );
    assert.strictEqual(
      result.rows[1][1],
      "=SUMIFS('业财对账结果'!B:B,'业财对账结果'!A:A,A3)"
    );
  });

  it("throws when lookup key is missing", function () {
    assert.throws(function () {
      calculate({
        op: "lookup",
        leftTable: "L",
        rightTable: "R",
        leftHeaders: ["id"],
        leftRows: [["A"]],
        rightHeaders: ["x"],
        key: "订单号",
        bringColumns: ["金额"],
      });
    }, /订单号/);
  });
});

describe("structured references", function () {
  const { structCol, thisRowCol, tableRefName } = require("../../src/excel/calculate-core");

  it("quotes CJK column names", function () {
    assert.strictEqual(structCol("T_流水", "金额"), "'T_流水'[[金额]]");
    assert.strictEqual(thisRowCol("订单号"), "[@[订单号]]");
  });

  it("leaves ASCII column names unquoted", function () {
    assert.strictEqual(structCol("Orders", "Amount"), "Orders[Amount]");
    assert.strictEqual(thisRowCol("Amount"), "[@Amount]");
  });

  it("quotes CJK table names in structured refs", function () {
    assert.strictEqual(tableRefName("T_finance_recon"), "T_finance_recon");
    assert.strictEqual(tableRefName("T_业财对账结果"), "'T_业财对账结果'");
    assert.strictEqual(
      structCol("T_业财对账结果", "left_item_price"),
      "'T_业财对账结果'[left_item_price]"
    );
  });
});

describe("fixRefFormula", function () {
  it("drops #REF! arguments and keeps the rest of the formula alive", function () {
    assert.strictEqual(fixRefFormula("=SUM(A1,#REF!,C1)"), "=SUM(A1,C1)");
  });
});
