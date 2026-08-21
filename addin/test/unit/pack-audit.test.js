require("ts-node/register/transpile-only");
const assert = require("assert");
const { auditHeaders, entryToRow } = require("../../src/excel/pack-audit");
const { HANDLED_TOOLS } = require("../../src/services/skill-registry");
const { manifestToolNames } = require("../../src/services/operator-catalog");

describe("append_pack_audit / pack-audit", function () {
  it("is registered in HANDLED_TOOLS and manifests", function () {
    assert.ok(HANDLED_TOOLS.has("append_pack_audit"));
    assert.ok(manifestToolNames().indexOf("append_pack_audit") >= 0);
  });

  it("headers include assumption_snapshot and match_rate at end (backward-compatible append)", function () {
    const h = auditHeaders();
    assert.strictEqual(h[0], "timestamp");
    assert.strictEqual(h[h.length - 2], "assumption_snapshot");
    assert.strictEqual(h[h.length - 1], "match_rate");
    assert.ok(h.indexOf("note") < h.indexOf("assumption_snapshot"));
  });

  it("entryToRow maps all fields including new snapshot/rate", function () {
    const row = entryToRow(
      {
        packId: "cross-border-ecommerce-finance",
        packVersion: "0.1.0",
        runType: "finance-reconciliation",
        matched: 10,
        leftOnly: 1,
        rightOnly: 2,
        conflict: 0,
        reviewPending: 3,
        sourceHashOrders: "abc",
        sourceHashAds: "def",
        note: "matched=10/13；净利为近似口径",
        assumptionSnapshot: '{"B2":7.2,"B4":0.08}',
        matchRate: 10 / 13,
      },
      "2026-08-21T00:00:00.000Z"
    );
    assert.strictEqual(row.length, auditHeaders().length);
    assert.strictEqual(row[0], "2026-08-21T00:00:00.000Z");
    assert.strictEqual(row[1], "cross-border-ecommerce-finance");
    assert.strictEqual(row[4], 10);
    assert.strictEqual(row[12], '{"B2":7.2,"B4":0.08}');
    assert.ok(Math.abs(Number(row[13]) - 10 / 13) < 1e-9);
  });

  it("entryToRow leaves optional new fields blank when omitted", function () {
    const row = entryToRow(
      { packId: "p", runType: "t", matched: 1 },
      "2026-08-21T00:00:00.000Z"
    );
    assert.strictEqual(row[12], "");
    assert.strictEqual(row[13], "");
  });
});
