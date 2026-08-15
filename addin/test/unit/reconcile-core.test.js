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
});
