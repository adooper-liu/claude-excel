require("ts-node/register/transpile-only");
const assert = require("assert");
const { reshape, dedupeChunk } = require("../../src/excel/reshape-core");

describe("reshape-core", function () {
  it("dedupes by key and keeps the first row", function () {
    const result = reshape({
      headers: ["id", "amt"],
      rows: [
        ["A", 1],
        ["A", 9],
        ["B", 2],
      ],
      op: "dedupe",
      keys: ["id"],
    });
    assert.deepStrictEqual(result.headers, ["id", "amt"]);
    assert.deepStrictEqual(result.rows, [
      ["A", 1],
      ["B", 2],
    ]);
    assert.strictEqual(result.dropped, 1);
  });

  it("trims key cells before dedupe", function () {
    const result = reshape({
      headers: ["id"],
      rows: [[" A "], ["A"]],
      op: "dedupe",
      keys: ["id"],
    });
    assert.strictEqual(result.rows.length, 1);
  });

  it("dedupes across blocks using a shared seen set", function () {
    const seen = new Set();
    const a = dedupeChunk(["id"], [["A"], ["B"]], ["id"], seen);
    const b = dedupeChunk(["id"], [[" A "], ["C"]], ["id"], seen);
    assert.deepStrictEqual(a.kept, [["A"], ["B"]]);
    assert.deepStrictEqual(b.kept, [["C"]]);
    assert.strictEqual(b.dropped, 1);
  });

  it("unpivots value columns into 属性/值", function () {
    const result = reshape({
      headers: ["地区", "1月", "2月"],
      rows: [["华东", 10, 20]],
      op: "unpivot",
      idColumns: ["地区"],
      valueColumns: ["1月", "2月"],
    });
    assert.deepStrictEqual(result.headers, ["地区", "属性", "值"]);
    assert.deepStrictEqual(result.rows, [
      ["华东", "1月", 10],
      ["华东", "2月", 20],
    ]);
  });

  it("splits a column by separator into numbered parts", function () {
    const result = reshape({
      headers: ["姓名", "标签"],
      rows: [["张三", "a,b,c"]],
      op: "split",
      column: "标签",
      separator: ",",
      maxParts: 3,
    });
    assert.deepStrictEqual(result.headers, ["姓名", "标签_1", "标签_2", "标签_3"]);
    assert.deepStrictEqual(result.rows, [["张三", "a", "b", "c"]]);
  });

  it("coerces a column to number and blanks invalid cells", function () {
    const result = reshape({
      headers: ["id", "金额"],
      rows: [
        ["A", "1,234"],
        ["B", " 12.5 "],
        ["C", "x"],
      ],
      op: "coerce",
      column: "金额",
      type: "number",
    });
    assert.deepStrictEqual(result.rows, [
      ["A", 1234],
      ["B", 12.5],
      ["C", null],
    ]);
    assert.strictEqual(result.converted, 2);
    assert.strictEqual(result.blanked, 1);
  });

  it("coerces mixed date formats to ISO", function () {
    const result = reshape({
      headers: ["date"],
      rows: [[45296], [20240105], ["2024-01-05"], ["2024/1/5"], ["bad"]],
      op: "coerce",
      column: "date",
      type: "date",
    });
    assert.deepStrictEqual(result.rows, [
      ["2024-01-05"],
      ["2024-01-05"],
      ["2024-01-05"],
      ["2024-01-05"],
      [null],
    ]);
    assert.strictEqual(result.converted, 4);
    assert.strictEqual(result.blanked, 1);
  });

  it("throws when a required column is missing", function () {
    assert.throws(function () {
      reshape({
        headers: ["id"],
        rows: [["A"]],
        op: "split",
        column: "标签",
        separator: ",",
      });
    }, /标签/);
  });

  it("projects columns by index with merge and number coerce", function () {
    const result = reshape({
      headers: ["+14", "Bedsure", "选项:", "CNY", "67", ".", "29", "4.4"],
      rows: [["+8", "BEDELITE", "选项:", "CNY", "50", ".", "00", "4.3"]],
      op: "project",
      headerless: true,
      columns: [
        { as: "排名", from: 0 },
        { as: "标题", from: 1 },
        { as: "售价", merge: [4, 5, 6], separator: "", coerce: "number" },
      ],
    });
    assert.deepStrictEqual(result.headers, ["排名", "标题", "售价"]);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0][0], "+14");
    assert.strictEqual(result.rows[1][1], "BEDELITE");
    assert.strictEqual(result.rows[0][2], 67.29);
    assert.strictEqual(result.rows[1][2], 50);
  });

  it("projects by column letter on a normal header row", function () {
    const result = reshape({
      headers: ["A", "B", "C"],
      rows: [
        ["1", "foo", "10"],
        ["2", "bar", "20"],
      ],
      op: "project",
      columns: [
        { as: "编号", from: "A" },
        { as: "名称", from: "B" },
        { as: "数量", from: "C", coerce: "number" },
      ],
    });
    assert.deepStrictEqual(result.rows, [
      ["1", "foo", 10],
      ["2", "bar", 20],
    ]);
  });

  it("flatten_reconcile collapses left_/right_ by status", function () {
    const result = reshape({
      headers: [
        "status",
        "left_sku",
        "right_sku",
        "left_amt",
        "right_amt",
        "__match_mode",
      ],
      rows: [
        ["matched", "A", "A", 10, 10, "exact"],
        ["left_only", "B", "", 5, "", "left_only"],
        ["right_only", "", "C", "", 7, "right_only"],
        ["conflict", "D", "D2", 1, 2, "conflict"],
      ],
      op: "flatten_reconcile",
    });
    assert.deepStrictEqual(result.headers, ["sku", "amt", "status", "__match_mode"]);
    assert.deepStrictEqual(result.rows[0], ["A", 10, "matched", "exact"]);
    assert.deepStrictEqual(result.rows[1], ["B", 5, "left_only", "left_only"]);
    assert.deepStrictEqual(result.rows[2], ["C", 7, "right_only", "right_only"]);
    assert.deepStrictEqual(result.rows[3], ["D", 1, "conflict", "conflict"]);
    assert.ok(
      result.headers.every(function (h) {
        return !/^left_/i.test(h) && !/^right_/i.test(h);
      })
    );
  });

  it("flatten_reconcile throws without headers", function () {
    assert.throws(function () {
      reshape({ headers: [], rows: [], op: "flatten_reconcile" });
    }, /表头/);
  });
});
