require("ts-node/register/transpile-only");
const assert = require("assert");
const { expandFillDown, parseFillType } = require("../../src/excel/fill-core");

describe("expandFillDown", function () {
  it("includes the source row and stretches to the last used row", function () {
    const dest = expandFillDown({ row: 1, col: 2, rowCount: 1, colCount: 1 }, 9);
    assert.deepStrictEqual(dest, { row: 1, col: 2, rowCount: 9, colCount: 1 });
  });

  it("refuses when there is nothing below the source", function () {
    assert.throws(function () {
      expandFillDown({ row: 5, col: 0, rowCount: 1, colCount: 1 }, 5);
    }, /没有可填充/);
  });
});

describe("parseFillType", function () {
  it("defaults and aliases formulas to copy", function () {
    assert.strictEqual(parseFillType(), "default");
    assert.strictEqual(parseFillType("formulas"), "copy");
  });
});
