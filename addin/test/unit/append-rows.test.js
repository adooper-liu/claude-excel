require("ts-node/register/transpile-only");
const assert = require("assert");
const { rowsToAppend } = require("../../src/excel/append-rows");

describe("rowsToAppend", function () {
  it("drops a repeated header row", function () {
    const header = ["店铺", "金额"];
    const incoming = [
      ["店铺", "金额"],
      ["A", "1"],
      ["B", "2"],
    ];
    assert.deepStrictEqual(rowsToAppend(header, incoming), [
      ["A", "1"],
      ["B", "2"],
    ]);
  });

  it("keeps rows when the first line is not the header", function () {
    const incoming = [
      ["A", "1"],
      ["B", "2"],
    ];
    assert.deepStrictEqual(rowsToAppend(["店铺", "金额"], incoming), incoming);
  });

  it("returns empty when only a duplicate header arrives", function () {
    assert.deepStrictEqual(rowsToAppend(["h"], [["h"]]), []);
  });
});
