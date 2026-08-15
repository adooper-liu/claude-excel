require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  isSetupRequest,
  isSkipSampleRequest,
  askGenerateSample,
  isAskGenerateSample,
  sampleKitsForAsk,
  sampleKitsForAction,
  buildGenerateCommand,
  SKIP_SAMPLE_COMMAND,
} = require("../../src/excel/intent-guard");
const { isCalculateRequest } = require("../../src/excel/calculate-intent");
const { isReshapeRequest } = require("../../src/excel/reshape-intent");
const { isReconcileRequest } = require("../../src/excel/reconcile-intent");
const { isExtractRequest } = require("../../src/excel/extract-intent");
const { selectToolsForRequest } = require("../../src/services/tools-for-request");

describe("askGenerateSample", function () {
  it("asks to generate instead of failing closed", function () {
    const msg = askGenerateSample("反透视");
    assert.ok(msg.indexOf("生成") >= 0);
    assert.ok(msg.indexOf("勾选") >= 0);
    assert.ok(msg.indexOf("需要一张带表头的表才能整形") < 0);
  });
});

describe("sample prompt choices", function () {
  it("detects a model ask and offers calculate kits", function () {
    const ask =
      "请问需要我先生成样例数据吗？比如：订单表（订单号、类别、金额）流水表（订单号、金额）一个带 #REF! 错误的公式源";
    assert.strictEqual(isAskGenerateSample(ask), true);
    const kits = sampleKitsForAsk(ask, "按类别求和");
    assert.ok(kits);
    assert.deepStrictEqual(kits.map((k) => k.id), ["orders", "ledger", "ref_error"]);
  });

  it("offers calculate kits for /计算", function () {
    const kits = sampleKitsForAsk("请勾选要生成的样例后点确认。", "/计算");
    assert.ok(kits);
    assert.deepStrictEqual(kits.map((k) => k.id), ["orders", "ledger", "ref_error"]);
  });

  it("offers two tables for reconcile", function () {
    const kits = sampleKitsForAction("对账");
    assert.deepStrictEqual(kits.map((k) => k.id), ["orders", "ledger"]);
  });

  it("builds a confirm command the setup detector accepts", function () {
    const cmd = buildGenerateCommand(["orders", "ledger", "ref_error"]);
    assert.strictEqual(isSetupRequest(cmd), true);
    assert.ok(cmd.indexOf("活公式") >= 0);
  });

  it("does not treat skip as a setup request", function () {
    assert.strictEqual(isSkipSampleRequest(SKIP_SAMPLE_COMMAND), true);
    assert.strictEqual(isSetupRequest(SKIP_SAMPLE_COMMAND), false);
  });
});

describe("isSetupRequest", function () {
  const prompt =
    "先随机生成一个表格，测试按类别求和、按订单号把金额匹配过来、修#REF!功能";

  it("detects generate-then-test prompts", function () {
    assert.strictEqual(isSetupRequest(prompt), true);
  });

  it("does not treat a short calculate command as setup", function () {
    assert.strictEqual(isSetupRequest("按类别求和"), false);
  });
});

describe("local shortcuts skip setup prompts", function () {
  const prompt =
    "先随机生成一个表格，测试按类别求和、按订单号把金额匹配过来、修#REF!功能";

  it("does not steal generate-then-test as calculate/reshape/reconcile", function () {
    assert.strictEqual(isCalculateRequest(prompt), false);
    assert.strictEqual(isReshapeRequest(prompt), false);
    assert.strictEqual(isReconcileRequest(prompt), false);
    assert.strictEqual(isExtractRequest(prompt), false);
  });

  it("keeps write_to_sheet so the model can create sample tables", function () {
    const tools = [
      { name: "write_to_sheet" },
      { name: "calculate_table" },
      { name: "ensure_table" },
    ];
    const names = selectToolsForRequest(prompt, tools).map((t) => t.name);
    assert.ok(names.indexOf("write_to_sheet") >= 0);
    assert.ok(names.indexOf("calculate_table") >= 0);
  });
});
