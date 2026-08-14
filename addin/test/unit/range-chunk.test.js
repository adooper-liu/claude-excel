require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  CHUNK_ROWS,
  INSPECT_SAMPLE_ROWS,
  chunkRanges,
  inspectSampleRows,
  formulaColumnRuns,
  valuesWithoutFormulas,
} = require("../../src/excel/range-chunk");

describe("range-chunk", function () {
  it("caps inspect samples so 万行 tables never send the body", function () {
    assert.strictEqual(INSPECT_SAMPLE_ROWS, 5);
    assert.strictEqual(inspectSampleRows(0), 0);
    assert.strictEqual(inspectSampleRows(3), 3);
    assert.strictEqual(inspectSampleRows(10000), 5);
  });

  it("splits 万行 reads/writes into 2000-row blocks", function () {
    assert.strictEqual(CHUNK_ROWS, 2000);
    assert.deepStrictEqual(chunkRanges(0, 2000), []);
    assert.deepStrictEqual(chunkRanges(100, 2000), [{ start: 0, count: 100 }]);
    assert.deepStrictEqual(chunkRanges(5000, 2000), [
      { start: 0, count: 2000 },
      { start: 2000, count: 2000 },
      { start: 4000, count: 1000 },
    ]);
  });

  it("blanks formula cells so the first write is values-only", function () {
    assert.deepStrictEqual(
      valuesWithoutFormulas([
        ["订单号", "金额"],
        ["A", "=SUMIFS(T[金额],T[类别],[@[类别]])"],
      ]),
      [
        ["订单号", "金额"],
        ["A", ""],
      ]
    );
  });

  it("writes a whole formula column as one run, not per cell", function () {
    const fx = "=SUMIFS(T[[金额]],T[[类别]],[@[类别]])";
    const runs = formulaColumnRuns([
      ["类别", "合计"],
      ["食品", fx],
      ["饮料", fx],
    ]);
    assert.strictEqual(runs.length, 1);
    assert.deepStrictEqual(runs[0], {
      col: 1,
      startRow: 1,
      formulas: [[fx], [fx]],
    });
  });

  it("keeps mixed columns as contiguous runs so values are not cleared", function () {
    const runs = formulaColumnRuns([
      ["h1", "h2"],
      ["a", "1"],
      ["b", "=X"],
      ["c", "=Y"],
      ["d", "2"],
    ]);
    assert.deepStrictEqual(runs, [
      { col: 1, startRow: 2, formulas: [["=X"], ["=Y"]] },
    ]);
  });
});
