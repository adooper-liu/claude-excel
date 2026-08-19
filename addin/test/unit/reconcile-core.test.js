require("ts-node/register/transpile-only");
const assert = require("assert");
const { reconcile } = require("../../src/excel/reconcile-core");

describe("reconcile-core", function () {
  it("classifies matched, left_only, right_only, and conflict", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [
        ["A", 10],
        ["B", 20],
        ["C", 30],
      ],
      rightHeaders: ["id", "amt"],
      rightRows: [
        ["A", 10],
        ["B", 99],
        ["D", 40],
      ],
      keys: ["id"],
      compareColumns: ["amt"],
    });
    assert.deepStrictEqual(result.counts, {
      matched: 1,
      left_only: 1,
      right_only: 1,
      conflict: 1,
    });
    const byKey = Object.fromEntries(result.rows.map((r) => [r.key, r.status]));
    assert.strictEqual(byKey.A, "matched");
    assert.strictEqual(byKey.B, "conflict");
    assert.strictEqual(byKey.C, "left_only");
    assert.strictEqual(byKey.D, "right_only");
  });

  it("does not match blank keys to each other", function () {
    const result = reconcile({
      leftHeaders: ["id", "x"],
      leftRows: [["", 1]],
      rightHeaders: ["id", "x"],
      rightRows: [["", 1]],
      keys: ["id"],
    });
    assert.strictEqual(result.counts.matched, 0);
    assert.strictEqual(result.counts.left_only, 1);
    assert.strictEqual(result.counts.right_only, 1);
  });

  it("zips duplicate keys instead of exploding a cartesian product", function () {
    const result = reconcile({
      leftHeaders: ["id", "n"],
      leftRows: [
        ["A", 1],
        ["A", 2],
      ],
      rightHeaders: ["id", "n"],
      rightRows: [["A", 1]],
      keys: ["id"],
      compareColumns: ["n"],
    });
    assert.strictEqual(result.counts.matched, 1);
    assert.strictEqual(result.counts.left_only, 1);
    assert.strictEqual(result.counts.right_only, 0);
  });

  it("matches duplicate keys by content, not row order", function () {
    const result = reconcile({
      leftHeaders: ["id", "n"],
      leftRows: [
        ["A", 1],
        ["A", 2],
      ],
      rightHeaders: ["id", "n"],
      rightRows: [
        ["A", 2],
        ["A", 1],
      ],
      keys: ["id"],
      compareColumns: ["n"],
    });
    assert.strictEqual(result.counts.matched, 2);
    assert.strictEqual(result.counts.conflict, 0);
  });

  it("trims key cells before matching", function () {
    const result = reconcile({
      leftHeaders: ["id"],
      leftRows: [[" A "]],
      rightHeaders: ["id"],
      rightRows: [["A"]],
      keys: ["id"],
    });
    assert.strictEqual(result.counts.matched, 1);
  });

  it("keeps exact output headers backward compatible (no __ audit columns by default)", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["A", 10]],
      rightHeaders: ["id", "amt"],
      rightRows: [["A", 10]],
      keys: ["id"],
      compareColumns: ["amt"],
    });
    assert.deepStrictEqual(result.outputHeaders, [
      "status",
      "key",
      "left_id",
      "left_amt",
      "right_id",
      "right_amt",
      "conflict_columns",
    ]);
    assert.deepStrictEqual(result.counts, {
      matched: 1,
      left_only: 0,
      right_only: 0,
      conflict: 0,
    });
    assert.strictEqual(result.reviewPending, 0);
  });

  it("normalize mode matches after trim_lower (trailing space + case)", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["ABC-01 ", 10]],
      rightHeaders: ["id", "amt"],
      rightRows: [["abc-01", 10]],
      keys: ["id"],
      compareColumns: ["amt"],
      matchMode: "normalize",
      keyNormalize: "trim_lower",
    });
    assert.strictEqual(result.counts.matched, 1);
    const row = result.rows[0];
    assert.strictEqual(row.status, "matched");
    assert.strictEqual(row.matchMode, "exact");
    assert.strictEqual(row.score, 1);
    assert.strictEqual(row.review, "auto");
  });

  it("normalize mode does not match genuinely different keys", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["ABC-01", 10]],
      rightHeaders: ["id", "amt"],
      rightRows: [["XYZ-01", 10]],
      keys: ["id"],
      compareColumns: ["amt"],
      matchMode: "normalize",
      keyNormalize: "trim_lower",
    });
    assert.deepStrictEqual(result.counts, {
      matched: 0,
      left_only: 1,
      right_only: 1,
      conflict: 0,
    });
  });

  it("date_window recovers rows within ±N days by minimal date difference", function () {
    const result = reconcile({
      leftHeaders: ["sku", "date", "amt"],
      leftRows: [
        ["SKU-016", "2026-01-15", 100],
        ["SKU-017", "2026-01-15", 100],
        ["SKU-018", "2026-01-15", 100],
      ],
      rightHeaders: ["sku", "date", "amt"],
      rightRows: [
        ["SKU-016", "2026-01-12", 100],
        ["SKU-017", "2026-01-12", 100],
        ["SKU-018", "2026-01-12", 100],
      ],
      keys: ["sku", "date"],
      compareColumns: ["amt"],
      matchMode: "date_window",
      dateWindowDays: 7,
      leftDateKey: "date",
      rightDateKey: "date",
    });
    assert.strictEqual(result.counts.matched, 3);
    assert.strictEqual(result.counts.left_only, 0);
    assert.strictEqual(result.counts.right_only, 0);
    assert.strictEqual(result.reviewPending, 3);
    result.rows.forEach(function (r) {
      assert.strictEqual(r.status, "matched");
      assert.strictEqual(r.matchMode, "date_window");
      assert.strictEqual(r.review, "需复核");
      assert.strictEqual(r.score, 1 - 3 / 8); // |Δ|=3, N=7 → 0.625
    });
    const data = result.outputRows[1];
    assert.strictEqual(data[data.length - 3], "date_window");
    assert.strictEqual(data[data.length - 1], "需复核");
  });

  it("date_window unifies Excel serial, yyyymmdd, and ISO date keys", function () {
    const result = reconcile({
      leftHeaders: ["sku", "date"],
      leftRows: [
        ["A", 45296],
        ["B", 20240105],
        ["C", "2024/1/5"],
      ],
      rightHeaders: ["sku", "date"],
      rightRows: [
        ["A", "2024-01-05"],
        ["B", 45296],
        ["C", "2024-01-05"],
      ],
      keys: ["sku", "date"],
      compareColumns: [],
      matchMode: "date_window",
      dateWindowDays: 7,
      leftDateKey: "date",
      rightDateKey: "date",
    });
    assert.strictEqual(result.counts.matched, 3);
    assert.strictEqual(result.reviewPending, 3);
    result.rows.forEach(function (r) {
      assert.strictEqual(r.status, "matched");
      assert.strictEqual(r.matchMode, "date_window");
      assert.strictEqual(r.score, 1);
    });
  });

  it("date_window picks the smallest date difference inside the window", function () {
    const result = reconcile({
      leftHeaders: ["sku", "date", "amt"],
      leftRows: [["S1", "2026-01-10", 50]],
      rightHeaders: ["sku", "date", "amt"],
      rightRows: [
        ["S1", "2026-01-01", 50], // 9 days → outside window
        ["S1", "2026-01-13", 50], // 3 days
        ["S1", "2026-01-08", 50], // 2 days → min
      ],
      keys: ["sku", "date"],
      compareColumns: ["amt"],
      matchMode: "date_window",
      dateWindowDays: 7,
      leftDateKey: "date",
      rightDateKey: "date",
    });
    assert.strictEqual(result.counts.matched, 1);
    assert.strictEqual(result.rows[0].right && result.rows[0].right.date, "2026-01-08");
    assert.strictEqual(result.rows[0].score, 1 - 2 / 8);
    assert.strictEqual(result.counts.right_only, 2);
  });

  it("date_window equal min diff becomes conflict, never a silent pick", function () {
    const result = reconcile({
      leftHeaders: ["sku", "date", "amt"],
      leftRows: [["S2", "2026-01-10", 50]],
      rightHeaders: ["sku", "date", "amt"],
      rightRows: [
        ["S2", "2026-01-07", 50], // diff 3
        ["S2", "2026-01-13", 50], // diff 3 → tie
      ],
      keys: ["sku", "date"],
      compareColumns: ["amt"],
      matchMode: "date_window",
      dateWindowDays: 7,
      leftDateKey: "date",
      rightDateKey: "date",
    });
    assert.strictEqual(result.counts.matched, 0);
    assert.strictEqual(result.counts.conflict, 1);
    assert.strictEqual(result.counts.right_only, 1);
    assert.strictEqual(result.reviewPending, 1);
    const row = result.rows[0];
    assert.strictEqual(row.status, "conflict");
    assert.strictEqual(row.matchMode, "conflict");
    assert.strictEqual(row.review, "需复核");
  });

  it("writes __match_mode / __match_score / __review when auditColumns is true", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["A", 10]],
      rightHeaders: ["id", "amt"],
      rightRows: [["A", 10]],
      keys: ["id"],
      compareColumns: ["amt"],
      auditColumns: true,
    });
    assert.deepStrictEqual(result.outputHeaders.slice(-3), [
      "__match_mode",
      "__match_score",
      "__review",
    ]);
    const data = result.outputRows[1];
    assert.strictEqual(data[data.length - 3], "exact");
    assert.strictEqual(data[data.length - 2], 1);
    assert.strictEqual(data[data.length - 1], "auto");
  });

  it("date_window requires date keys when the mode is enabled", function () {
    assert.throws(function () {
      reconcile({
        leftHeaders: ["sku", "date"],
        leftRows: [],
        rightHeaders: ["sku", "date"],
        rightRows: [],
        keys: ["sku", "date"],
        matchMode: "date_window",
        dateWindowDays: 7,
      });
    }, /leftDateKey/);
  });

  it("compareTolerance absorbs float drift inside ±tolerance", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [
        ["A", 10.005],
        ["B", 20],
      ],
      rightHeaders: ["id", "amt"],
      rightRows: [
        ["A", 10.01],
        ["B", 20],
      ],
      keys: ["id"],
      compareColumns: ["amt"],
      compareTolerance: 0.01,
    });
    assert.strictEqual(result.counts.conflict, 0);
    assert.strictEqual(result.counts.matched, 2);
    assert.strictEqual(result.rows[0].status, "matched");
  });

  it("compareTolerance does not merge genuinely different values", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["A", 10]],
      rightHeaders: ["id", "amt"],
      rightRows: [["A", 10.1]],
      keys: ["id"],
      compareColumns: ["amt"],
      compareTolerance: 0.01,
    });
    assert.strictEqual(result.counts.conflict, 1);
    assert.strictEqual(result.counts.matched, 0);
  });

  it("compareTolerance treats numeric strings within tolerance as equal", function () {
    const result = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["A", 1]],
      rightHeaders: ["id", "amt"],
      rightRows: [["A", "1.00"]],
      keys: ["id"],
      compareColumns: ["amt"],
      compareTolerance: 0.01,
    });
    assert.strictEqual(result.counts.matched, 1);
    assert.strictEqual(result.counts.conflict, 0);
  });

  it("compareTolerance leaves non-numeric compare columns on string equality", function () {
    const result = reconcile({
      leftHeaders: ["id", "note"],
      leftRows: [["A", "abc"]],
      rightHeaders: ["id", "note"],
      rightRows: [["A", "abd"]],
      keys: ["id"],
      compareColumns: ["note"],
      compareTolerance: 0.01,
    });
    assert.strictEqual(result.counts.conflict, 1);
  });

  it("compareTolerance defaults to exact (0) and never touches key columns", function () {
    const drift = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["A", 10]],
      rightHeaders: ["id", "amt"],
      rightRows: [["A", 10.01]],
      keys: ["id"],
      compareColumns: ["amt"],
    });
    assert.strictEqual(drift.counts.conflict, 1, "no tolerance given → exact");
    const keyed = reconcile({
      leftHeaders: ["id", "amt"],
      leftRows: [["1.00", 10]],
      rightHeaders: ["id", "amt"],
      rightRows: [["1", 10]],
      keys: ["id"],
      compareColumns: ["amt"],
      compareTolerance: 0.5,
    });
    assert.strictEqual(keyed.counts.matched, 0, "tolerance never applies to keys");
    assert.strictEqual(keyed.counts.conflict, 0, "numeric keys just differ → not conflict on amt");
  });
});
