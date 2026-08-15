require("ts-node/register/transpile-only");
const assert = require("assert");
const { letterToIndex, columnKeyToIndex, mapFilterOperator } = require("../../src/excel/filter-core");

describe("columnKeyToIndex", function () {
  it("maps A/AA letters relative to the range start", function () {
    assert.strictEqual(letterToIndex("A"), 0);
    assert.strictEqual(letterToIndex("B"), 1);
    assert.strictEqual(letterToIndex("AA"), 26);
    assert.strictEqual(columnKeyToIndex("C", [], 2), 0);
    assert.strictEqual(columnKeyToIndex("B", ["店铺", "金额"]), 1);
  });

  it("maps 1-based numbers and header names", function () {
    assert.strictEqual(columnKeyToIndex("2"), 1);
    assert.strictEqual(columnKeyToIndex("金额", ["店铺", "金额"]), 1);
    assert.throws(function () {
      columnKeyToIndex("国家", ["店铺"]);
    }, /找不到列/);
  });
});

describe("mapFilterOperator", function () {
  it("maps comparisons to AutoFilter custom criteria", function () {
    assert.deepStrictEqual(mapFilterOperator("greaterThan", "100"), {
      filterOn: "custom",
      criterion1: ">100",
    });
    assert.deepStrictEqual(mapFilterOperator("contains", "京东"), {
      filterOn: "custom",
      criterion1: "*京东*",
    });
    assert.deepStrictEqual(mapFilterOperator("blanks"), {
      filterOn: "custom",
      criterion1: "=",
    });
  });

  it("maps equals to a values filter and between to And", function () {
    assert.deepStrictEqual(mapFilterOperator("equals", "华东"), {
      filterOn: "values",
      criterion1: "华东",
      values: ["华东"],
    });
    assert.deepStrictEqual(mapFilterOperator("between", "1", "9"), {
      filterOn: "custom",
      criterion1: ">=1",
      criterion2: "<=9",
      operator: "And",
    });
  });
});
