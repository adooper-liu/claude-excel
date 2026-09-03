require("ts-node/register/transpile-only");
const assert = require("assert");
const path = require("path");
const { selectToolsForRequest } = require("../../src/services/tools-for-request");
const { runFinanceRecipe, withTempFixtures } = require("./finance-reconciliation-harness");

const FIXTURE_DIR = path.join(__dirname, "fixtures");

/**
 * 独立期望值：widget-b 净利（不复用 harness 的 calculateProfit，避免同源自检）。
 * fixture O004: Widget-B ×1 @15.00，无广告、无退款。
 * 口径与 SKILL.md 附录 B 一致（收入=数量×单价×汇率B2；佣金=收入×B3；
 * FBA=件数×B5×(1+B6燃油)×汇率；仓储=件数×B7×汇率；手续费=收入×B8）。
 * 若 fixture 的 widget-b 行变更，此处需同步。
 */
function expectedWidgetBNet() {
  const qty = 1;
  const price = 15;
  const rate = 7.2; // B2
  const revenue = qty * price * rate; // 108
  const commission = revenue * 0.15; // B3
  const fba = qty * 3.22 * (1 + 0.035) * rate; // B5=3.22, B6=0.035
  const storage = qty * 1.5 * rate; // B7
  const advertising = 0; // 无广告
  const refund = 0; // 无退款
  const paymentFee = revenue * 0.025; // B8
  return revenue - commission - fba - storage - advertising - refund - paymentFee; // 54.30456
}

describe("finance-reconciliation integration (gate-1b-mvp section 3)", function () {
  it("creates a visible profit pivot with data", async function () {
    await withTempFixtures(FIXTURE_DIR, async function (fixtures) {
      const result = await runFinanceRecipe(fixtures);
      const pivot = result.workbook.sheets["业财利润透视"];

      assert.ok(pivot, "missing 业财利润透视 sheet");
      assert.ok(pivot.rows.length >= 2, "profit pivot has no data rows");
    });
  });

  it("appends the complete 14-column pack audit record", async function () {
    await withTempFixtures(FIXTURE_DIR, async function (fixtures) {
      const result = await runFinanceRecipe(fixtures);
      const audit = result.workbook.sheets._pack_audit;

      assert.ok(audit, "missing _pack_audit sheet");
      assert.deepStrictEqual(audit.rows[0], [
        "timestamp",
        "packId",
        "packVersion",
        "runType",
        "matched",
        "left_only",
        "right_only",
        "conflict",
        "review_pending",
        "sourceHash_orders",
        "sourceHash_ads",
        "note",
        "assumption_snapshot",
        "match_rate",
      ]);
      assert.strictEqual(audit.rows[1].length, 14);
      assert.strictEqual(audit.rows[1][1], "cross-border-ecommerce-finance");
      assert.strictEqual(audit.rows[1][3], "finance-reconciliation");
      assert.deepStrictEqual(audit.rows[1].slice(4, 9), [3, 2, 1, 0, 1]);
      assert.strictEqual(audit.rows[1][13], 0.5);
      assert.strictEqual(audit.rows[1][9].length, 64);
      assert.strictEqual(audit.rows[1][10].length, 64);
    });
  });

  it("keeps the fixture profit within 0.01 of the independent manual result", async function () {
    await withTempFixtures(FIXTURE_DIR, async function (fixtures) {
      const result = await runFinanceRecipe(fixtures);
      const profitRows = result.workbook.sheets["业财利润公式"].rows;
      const widgetB = profitRows.find((row) => row[0] === "widget-b");

      assert.ok(widgetB, "missing Widget-B profit row");
      // expected 由本测试独立展开（expectedWidgetBNet），与 harness 的 calculateProfit 互为独立实现
      assert.ok(Math.abs(widgetB[2] - expectedWidgetBNet()) <= 0.01, `unexpected net profit: ${widgetB[2]}`);
    });
  });

  it("keeps unrelated tools outside the finance recipe surface", function () {
    const tools = [
      { name: "write_to_sheet" },
      { name: "reconcile_tables" },
      { name: "create_pivot" },
      { name: "append_pack_audit" },
      { name: "find_replace" },
      { name: "web_fetch" },
    ];
    const names = selectToolsForRequest("跑跨境业财", tools, "finance-reconciliation").map(
      (tool) => tool.name
    );

    assert.deepStrictEqual(names, [
      "write_to_sheet",
      "reconcile_tables",
      "create_pivot",
      "append_pack_audit",
    ]);
  });
});
