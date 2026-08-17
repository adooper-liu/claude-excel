require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  isIdLikeHeader,
  idLikeColumnIndexes,
  numberToPlainText,
  resolveIdCell,
  gridIdCellsAsText,
} = require("../../src/excel/id-cell-core");

describe("id-cell-core", function () {
  it("detects waybill-like headers", function () {
    assert.strictEqual(isIdLikeHeader("快递面单号"), true);
    assert.strictEqual(isIdLikeHeader("订单号"), true);
    assert.strictEqual(isIdLikeHeader("首次扫描时间_文本"), false);
  });

  it("stringifies large numeric ids without scientific notation", function () {
    assert.strictEqual(numberToPlainText(382973000000), "382973000000");
    assert.strictEqual(numberToPlainText(8630180000000), "8630180000000");
  });

  it("prefers all-digit displayed text over numeric value", function () {
    assert.strictEqual(resolveIdCell(3.82973e11, "382973000000"), "382973000000");
  });

  it("keeps alphanumeric waybill text", function () {
    assert.strictEqual(resolveIdCell("D10017597715566", "D10017597715566"), "D10017597715566");
  });

  it("converts id columns when writing grids", function () {
    const out = gridIdCellsAsText(
      [[3.82973e11, "ok"]],
      ["快递面单号", "备注"]
    );
    assert.strictEqual(out[0][0], "382973000000");
    assert.strictEqual(out[0][1], "ok");
    assert.deepStrictEqual(idLikeColumnIndexes(["快递面单号", "备注"]), [0]);
  });
});
