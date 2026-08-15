const assert = require("assert");
const { jsonToGrid } = require("../../../extension/json-table.js");

describe("jsonToGrid", function () {
  it("reads list of objects inside data.records", function () {
    const grid = jsonToGrid({
      data: {
        records: [
          { 店铺: "A", 金额: 1, password: "no" },
          { 店铺: "B", 金额: 2 },
        ],
      },
    });
    assert.deepStrictEqual(grid[0], ["店铺", "金额"]);
    assert.deepStrictEqual(grid[1], ["A", "1"]);
    assert.deepStrictEqual(grid[2], ["B", "2"]);
  });

  it("reads a raw array of objects", function () {
    const grid = jsonToGrid([
      { sku: "1", qty: 3 },
      { sku: "2", qty: 4 },
    ]);
    assert.strictEqual(grid.length, 3);
    assert.deepStrictEqual(grid[0], ["sku", "qty"]);
  });

  it("returns empty for login-shaped objects", function () {
    assert.deepStrictEqual(jsonToGrid({ token: "x", user: { name: "a" } }), []);
  });

  it("rejects tiny config-like grids for auto-capture", function () {
    const { isCaptureGrid, isUsableGrid } = require("../../../extension/json-table.js");
    const flyout = [
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
    ];
    assert.strictEqual(isUsableGrid(flyout), true);
    assert.strictEqual(isCaptureGrid(flyout), false);
    const listing = [
      ["标题", "价格", "ASIN", "评分"],
      ["A", "1", "B0", "4"],
      ["B", "2", "B1", "5"],
    ];
    assert.strictEqual(isCaptureGrid(listing), true);
  });
});
