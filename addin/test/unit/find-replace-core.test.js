require("ts-node/register/transpile-only");
const assert = require("assert");
const { replaceInGrid } = require("../../src/excel/find-replace-core");

describe("replaceInGrid", function () {
  it("replaces values and leaves formula cells alone", function () {
    const r = replaceInGrid(
      [["京东", 1], ["京东仓", 2]],
      [["京东", 1], ["=A2", 2]],
      { find: "京东", replace: "JD" }
    );
    assert.strictEqual(r.values[0][0], "JD");
    assert.strictEqual(r.values[1][0], "京东仓");
    assert.strictEqual(r.formulas[1][0], "=A2");
    assert.strictEqual(r.replaced, 1);
    assert.strictEqual(r.skippedFormulas, 1);
  });

  it("replaces formula text when lookIn is formulas", function () {
    const r = replaceInGrid([[1]], [["=假设!B5*A1"]], {
      find: "假设!B5",
      replace: "假设!B6",
      lookIn: "formulas",
    });
    assert.strictEqual(r.formulas[0][0], "=假设!B6*A1");
    assert.strictEqual(r.replaced, 1);
  });

  it("completeMatch only swaps the whole cell", function () {
    const r = replaceInGrid([["京东"], ["京东仓"]], [["京东"], ["京东仓"]], {
      find: "京东",
      replace: "JD",
      completeMatch: true,
    });
    assert.strictEqual(r.values[0][0], "JD");
    assert.strictEqual(r.values[1][0], "京东仓");
    assert.strictEqual(r.replaced, 1);
  });
});
