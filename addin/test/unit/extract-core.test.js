require("ts-node/register/transpile-only");
const assert = require("assert");
const { extractColumn, extractChunk, normalizeCell } = require("../../src/excel/extract-core");

describe("normalizeCell", function () {
  it("trims and collapses spaces", function () {
    assert.strictEqual(normalizeCell("  Foo   BAR  ", "keep"), "Foo BAR");
  });

  it("title-cases Latin words and leaves CJK", function () {
    assert.strictEqual(normalizeCell("amazon 旗舰店", "title"), "Amazon 旗舰店");
    assert.strictEqual(normalizeCell("AMAZON", "title"), "Amazon");
  });

  it("lower/upper only change Latin case", function () {
    assert.strictEqual(normalizeCell("Amazon 店", "lower"), "amazon 店");
    assert.strictEqual(normalizeCell("Amazon 店", "upper"), "AMAZON 店");
  });
});

describe("extractColumn", function () {
  it("drops blank rows and writes a header row", function () {
    const r = extractColumn({
      headers: ["店铺"],
      rows: [[" Amazon "], [""], ["tmall"], [null]],
      caseMode: "title",
    });
    assert.deepStrictEqual(r.outputRows, [["店铺"], ["Amazon"], ["Tmall"]]);
    assert.strictEqual(r.blankDropped, 2);
    assert.strictEqual(r.sourceRows, 4);
  });

  it("dedupes after case unification", function () {
    const r = extractColumn({
      headers: ["店铺"],
      rows: [["AMAZON"], ["amazon"], ["Tmall"]],
      caseMode: "title",
      unique: true,
    });
    assert.deepStrictEqual(r.rows, [["Amazon"], ["Tmall"]]);
    assert.strictEqual(r.uniqueDropped, 1);
  });
});

describe("extractChunk", function () {
  it("dedupes across blocks using a shared seen set", function () {
    const seen = new Set();
    const a = extractChunk([["AMAZON"], ["tmall"]], 1, "title", true, seen);
    const b = extractChunk([["amazon"], ["JD"]], 1, "title", true, seen);
    assert.deepStrictEqual(a.rows, [["Amazon"], ["Tmall"]]);
    assert.deepStrictEqual(b.rows, [["Jd"]]);
    assert.strictEqual(b.uniqueDropped, 1);
  });
});
