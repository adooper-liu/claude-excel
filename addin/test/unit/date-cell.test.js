require("ts-node/register/transpile-only");
const assert = require("assert");
const { parseDateCell, dayToIso } = require("../../src/excel/date-cell");

describe("date-cell", function () {
  it("parses Excel serial, yyyymmdd, and ISO to the same day number", function () {
    const expected = parseDateCell("2024-01-05");
    assert.strictEqual(parseDateCell(45296), expected);
    assert.strictEqual(parseDateCell(20240105), expected);
    assert.strictEqual(parseDateCell("2024/1/5"), expected);
  });

  it("formats day numbers back to ISO", function () {
    assert.strictEqual(dayToIso(45296), "2024-01-05");
    assert.strictEqual(dayToIso(45297), "2024-01-06");
    assert.strictEqual(dayToIso(46027), "2026-01-05");
    assert.strictEqual(dayToIso(parseDateCell(20240105)), "2024-01-05");
  });

  it("rejects non-dates", function () {
    assert.strictEqual(parseDateCell(null), null);
    assert.strictEqual(parseDateCell(""), null);
    assert.strictEqual(parseDateCell("not-a-date"), null);
    assert.strictEqual(parseDateCell(70000), null);
    assert.strictEqual(parseDateCell(true), null);
  });
});
