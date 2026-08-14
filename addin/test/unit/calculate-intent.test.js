require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  isCalculateRequest,
  parseCalculateIntent,
} = require("../../src/excel/calculate-intent");

describe("isCalculateRequest", function () {
  it("matches 按类别求和", function () {
    assert.strictEqual(isCalculateRequest("按类别求和"), true);
  });

  it("matches 把金额匹配过来", function () {
    assert.strictEqual(isCalculateRequest("把金额匹配过来"), true);
  });

  it("does not steal 对账 or 去重", function () {
    assert.strictEqual(isCalculateRequest("按订单号对账"), false);
    assert.strictEqual(isCalculateRequest("按订单号去重"), false);
  });
});

describe("parseCalculateIntent", function () {
  it("parses SUMIFS group-by", function () {
    const intent = parseCalculateIntent("按类别求和");
    assert.strictEqual(intent.op, "sumifs");
    assert.strictEqual(intent.groupBy, "类别");
  });

  it("parses lookup bring column", function () {
    const intent = parseCalculateIntent("按订单号把金额匹配过来");
    assert.strictEqual(intent.op, "lookup");
    assert.strictEqual(intent.key, "订单号");
    assert.strictEqual(intent.bringColumns[0], "金额");
  });
});
