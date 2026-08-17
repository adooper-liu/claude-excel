require("ts-node/register/transpile-only");
const assert = require("assert");
const { reshape, coerceColumnsChunk } = require("../../src/excel/reshape-core");
const { inferColumnFormats } = require("../../src/excel/column-format-core");

describe("reshape coerce_columns", function () {
  it("coerces id and amount columns on a small grid", function () {
    const hints = inferColumnFormats(
      ["快递面单号", "金额"],
      [["382973000000", "1,234.5"]]
    );
    const result = reshape({
      headers: ["快递面单号", "金额"],
      rows: [
        [382973000000, "1,234.5"],
        ["D10017597715566", "x"],
      ],
      op: "coerce_columns",
      formatHints: hints,
    });
    assert.strictEqual(typeof result.rows[0][0], "string");
    assert.strictEqual(result.rows[0][0], "382973000000");
    assert.strictEqual(result.rows[0][1], 1234.5);
    assert.strictEqual(result.rows[1][0], "D10017597715566");
    assert.strictEqual(result.blanked, 1);
  });

  it("coerces chunks with displayed text for ids", function () {
    const hints = inferColumnFormats(["快递面单号"], []);
    const part = coerceColumnsChunk(
      ["快递面单号"],
      [[3.82973e11]],
      hints,
      [["382973000000"]]
    );
    assert.strictEqual(part.rows[0][0], "382973000000");
  });
});
