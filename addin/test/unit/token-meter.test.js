require("ts-node/register/transpile-only");
const assert = require("assert");
const { addUsage, formatTokenBadge, estimateCostUsd } = require("../../src/services/token-meter");

describe("token-meter", function () {
  it("accumulates tokens by model", function () {
    let s = addUsage(undefined, "deepseek-v4-pro[1m]", 1000);
    s = addUsage(s, "deepseek-v4-pro[1m]", 500);
    s = addUsage(s, "deepseek-v4-flash", 200);
    assert.strictEqual(s.tokens, 1700);
    assert.strictEqual(s.byModel["deepseek-v4-pro[1m]"], 1500);
    assert.strictEqual(s.byModel["deepseek-v4-flash"], 200);
  });

  it("formats a compact badge without dumping raw counts over 999", function () {
    const s = addUsage(undefined, "deepseek-v4-pro[1m]", 12400);
    const label = formatTokenBadge(s);
    assert.ok(/12\.4k/.test(label));
    assert.ok(/\$/.test(label));
    assert.ok(label.indexOf("12400") < 0);
  });

  it("estimates cost from blended rate", function () {
    const usd = estimateCostUsd(1_000_000, "deepseek-v4-pro[1m]");
    assert.ok(usd > 0);
    assert.ok(usd < 5);
  });
});
