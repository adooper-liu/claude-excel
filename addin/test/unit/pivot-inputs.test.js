require("ts-node/register/transpile-only");
const assert = require("assert");
const { planPivot, parseAggregation, matchField, uniqueName } = require("../../src/excel/pivot-core");
const { assertWritableInputs, blockedFormulaCells, normalizeA1 } = require("../../src/excel/write-inputs-core");

describe("pivot-core", function () {
  it("maps headers and aggregations without guessing missing columns", function () {
    const plan = planPivot(["客户", "金额", "月份"], {
      rows: ["客户"],
      values: [{ field: "金额", aggregation: "求和" }],
    });
    assert.deepStrictEqual(plan.rows, ["客户"]);
    assert.strictEqual(plan.values[0].aggregation, "sum");
    assert.strictEqual(parseAggregation("平均"), "average");
    assert.strictEqual(matchField("金额", ["客户", "金额"]), "金额");
    assert.throws(function () {
      matchField("类别", ["客户", "金额"]);
    }, /不在表头/);
  });

  it("avoids colliding sheet names", function () {
    assert.strictEqual(uniqueName("透视", ["透视"]), "透视2");
  });
});

describe("write-inputs-core", function () {
  it("refuses formula cells and allows inputs", function () {
    assert.strictEqual(normalizeA1("$b$5"), "B5");
    const blocked = blockedFormulaCells({ B5: "=C5*1.1", C5: "" }, [
      { address: "B5", value: 0.08 },
      { address: "C5", value: 0.08 },
    ]);
    assert.strictEqual(blocked.length, 1);
    assert.strictEqual(blocked[0].address, "B5");
    assert.throws(function () {
      assertWritableInputs({ B5: "=A1" }, [{ address: "B5", value: 1 }]);
    }, /拒绝覆盖公式格/);
    assertWritableInputs({ B5: "0.1" }, [{ address: "B5", value: 0.08 }]);
  });
});
