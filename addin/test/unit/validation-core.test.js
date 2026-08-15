require("ts-node/register/transpile-only");
const assert = require("assert");
const { buildValidationRule } = require("../../src/excel/validation-core");

describe("buildValidationRule", function () {
  it("builds a dropdown list from a comma source", function () {
    const r = buildValidationRule({ type: "list", source: "是,否" });
    assert.deepStrictEqual(r, {
      kind: "rule",
      rule: { list: { inCellDropDown: true, source: "是,否" } },
      errorMessage: undefined,
      allowBlank: undefined,
    });
  });

  it("builds a between-number rule and clear", function () {
    const n = buildValidationRule({ type: "decimal", operator: "between", formula1: "0", formula2: "1" });
    assert.strictEqual(n.kind, "rule");
    assert.deepStrictEqual(n.rule.decimal, { formula1: "0", operator: "Between", formula2: "1" });
    assert.deepStrictEqual(buildValidationRule({ type: "clear" }), { kind: "clear" });
  });

  it("refuses list without source", function () {
    assert.throws(function () {
      buildValidationRule({ type: "list" });
    }, /source/);
  });
});
