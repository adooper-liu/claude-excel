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
      '=IFERROR(INDEX(T_流水[[金额]],MATCH([@[订单号]],T_流水[[订单号]],0)),"")'
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
    assert.strictEqual(result.rows[0][1], "=SUMIFS(T_订单[[金额]],T_订单[[类别]],[@[类别]])");
    assert.ok(result.rows[0][1] !== 15);
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
  const { structCol, thisRowCol } = require("../../src/excel/calculate-core");

  it("quotes CJK column names", function () {
    assert.strictEqual(structCol("T_流水", "金额"), "T_流水[[金额]]");
    assert.strictEqual(thisRowCol("订单号"), "[@[订单号]]");
  });

  it("leaves ASCII column names unquoted", function () {
    assert.strictEqual(structCol("Orders", "Amount"), "Orders[Amount]");
    assert.strictEqual(thisRowCol("Amount"), "[@Amount]");
  });
});

describe("fixRefFormula", function () {
  it("drops #REF! arguments and keeps the rest of the formula alive", function () {
    assert.strictEqual(fixRefFormula("=SUM(A1,#REF!,C1)"), "=SUM(A1,C1)");
  });
});
