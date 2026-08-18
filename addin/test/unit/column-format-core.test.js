require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  inferColumnFormats,
  isIdLikeHeader,
  applyFormatToCell,
  textColumnIndexes,
  gridCellsForWrite,
} = require("../../src/excel/column-format-core");

describe("column-format-core", function () {
  it("infers id_text for waybill headers and long numeric samples", function () {
    const hints = inferColumnFormats(
      ["快递面单号", "备注"],
      [[382973099357, "ok"]]
    );
    assert.strictEqual(hints[0].kind, "id_text");
    assert.strictEqual(hints[0].excelFormat, "@");
    assert.strictEqual(hints[1].kind, "plain_text");
  });

  it("infers datetime from header and ISO samples", function () {
    const hints = inferColumnFormats(
      ["首次扫描时间_文本"],
      [["2026-08-04T00:00:00-07:00"]]
    );
    assert.strictEqual(hints[0].kind, "datetime");
  });

  it("applies id_text without scientific notation in write grid", function () {
    const hints = inferColumnFormats(["快递面单号"], []);
    const grid = gridCellsForWrite([[382973000000]], hints);
    assert.strictEqual(grid[0][0], "382973000000");
    assert.strictEqual(typeof grid[0][0], "string");
  });

  it("keeps leading-zero values as text (ZONE 002 / 工号 026014) — 通用规则非特例", function () {
    const hints = inferColumnFormats(["ZONE/区域"], [["002"], ["003"]]);
    assert.strictEqual(hints[0].kind, "plain_text");
    assert.strictEqual(applyFormatToCell("002", hints[0].kind), "002");
    const worker = inferColumnFormats(["创建人.工号"], [["026014"]]);
    assert.strictEqual(worker[0].kind, "plain_text");
  });

  it("does not treat decimal rates (0.5 / 0.25) as leading-zero text", function () {
    const hints = inferColumnFormats(["燃油费率"], [["0.25"], ["0.5"]]);
    assert.notStrictEqual(hints[0].kind, "plain_text");
  });

  it("keeps numeric values numeric even when header contains a date keyword", function () {
    const hints = inferColumnFormats(["days_to date"], [[120, 365]]);
    assert.notStrictEqual(hints[0].kind, "datetime");
    const applied = applyFormatToCell(120, hints[0].kind);
    assert.strictEqual(typeof applied, "number");
    assert.strictEqual(applied, 120);
  });

  it("lists text column indexes from hints", function () {
    const hints = inferColumnFormats(["快递面单号", "金额"], []);
    assert.deepStrictEqual(textColumnIndexes(hints), [0]);
    assert.strictEqual(isIdLikeHeader("快递面单号"), true);
    assert.strictEqual(applyFormatToCell(3.82973e11, "id_text", "382973000000"), "382973000000");
  });
});
