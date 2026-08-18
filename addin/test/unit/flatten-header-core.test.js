require("ts-node/register/transpile-only");
const assert = require("assert");
const { flattenHeader, preserveRowForFlatten } = require("../../src/excel/flatten-header-core");

describe("flatten-header-core", function () {
  it("combines merged parent headers with child row labels", function () {
    const result = flattenHeader({
      headerRows: 2,
      grid: [
        ["首次扫描时间", "", "送达时间", "", "头表创建时间 UTC+8"],
        [
          "首次扫描时间(文本)",
          "首次扫描时间UTC0",
          "扫描时区.名称",
          "扫描时区(兜底).名称",
          "",
        ],
        ["2026-08-04T00:00:00-07:00", "8/4/2026 07:00:00", "GMT+1", "GMT+1", "8/5/2026 08:41:19"],
      ],
    });
    assert.deepStrictEqual(result.headers, [
      "首次扫描时间_文本",
      "首次扫描时间_UTC0",
      "扫描时区_名称",
      "扫描时区兜底_名称",
      "头表创建时间UTC+8",
    ]);
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0][0], "2026-08-04T00:00:00-07:00");
  });

  it("fill-forwards merged top-row cells across blank spans", function () {
    const result = flattenHeader({
      headerRows: 2,
      grid: [
        ["大类A", "", "大类B"],
        ["子1", "子2", "子3"],
        [1, 2, 3],
      ],
    });
    assert.deepStrictEqual(result.headers, ["大类A_子1", "大类A_子2", "大类B_子3"]);
  });

  it("deduplicates identical flattened names", function () {
    const result = flattenHeader({
      headerRows: 2,
      grid: [
        ["同", "同"],
        ["列", "列"],
        [1, 2],
      ],
    });
    assert.deepStrictEqual(result.headers, ["同_列", "同_列_2"]);
  });

  it("preserves numeric and date values during flatten, only text-protecting id columns", function () {
    const row = preserveRowForFlatten(
      ["SKU-B", 120, 365, "2026-08-04T00:00:00-07:00"],
      [0],
      ["SKU-B", "120", "365", "2026-08-04T00:00:00-07:00"]
    );
    assert.strictEqual(row[0], "SKU-B"); // id 列 → 文本保真（防科学计数法）
    assert.strictEqual(row[1], 120); // 数字原样，不转日期
    assert.strictEqual(row[2], 365);
    assert.strictEqual(row[3], "2026-08-04T00:00:00-07:00"); // 时间串原样
  });
});
