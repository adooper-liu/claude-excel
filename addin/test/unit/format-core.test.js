require("ts-node/register/transpile-only");
const assert = require("assert");
const { parseFormatInput, freezeAtCell } = require("../../src/excel/format-core");

describe("parseFormatInput", function () {
  it("maps alignment and border aliases", function () {
    const fmt = parseFormatInput({ hAlign: "center", vAlign: "middle", border: "thin", wrap: true });
    assert.strictEqual(fmt.hAlign, "Center");
    assert.strictEqual(fmt.vAlign, "Center");
    assert.strictEqual(fmt.border, "Thin");
    assert.strictEqual(fmt.wrap, true);
  });

  it("treats freeze 0,0 as unfreeze", function () {
    assert.strictEqual(freezeAtCell(0, 0), null);
    assert.deepStrictEqual(freezeAtCell(1, 1), { row: 1, col: 1 });
    assert.strictEqual(freezeAtCell(), undefined);
  });
});
