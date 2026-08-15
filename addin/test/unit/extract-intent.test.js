require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  isExtractRequest,
  parseExtractIntent,
  parseColumnName,
} = require("../../src/excel/extract-intent");
const { isReshapeRequest } = require("../../src/excel/reshape-intent");
const { resolveContinuedAsk, isContinueRequest } = require("../../src/excel/intent-guard");

describe("isExtractRequest", function () {
  it("matches 提取选中列 plus 大小写统一", function () {
    assert.strictEqual(isExtractRequest("提取选中列，并规范格式与大小写统一"), true);
  });

  it("matches 提取店铺列 plus 规范大小写", function () {
    assert.strictEqual(isExtractRequest("提取店铺列，并规范大小写与格式"), true);
  });

  it("does not steal /规范 or 对账", function () {
    assert.strictEqual(isExtractRequest("/规范"), false);
    assert.strictEqual(isExtractRequest("按订单号对账"), false);
    assert.strictEqual(isExtractRequest("把表头加粗"), false);
  });

  it("does not steal 按列去重 or 继续去重", function () {
    assert.strictEqual(isExtractRequest("按订单号去重"), false);
    assert.strictEqual(isExtractRequest("继续去重"), false);
    assert.strictEqual(isReshapeRequest("提取店铺列，并规范大小写与格式"), false);
  });
});

describe("parseExtractIntent", function () {
  it("defaults 大小写统一 to title case without unique", function () {
    const intent = parseExtractIntent("提取选中列，并规范格式与大小写统一");
    assert.strictEqual(intent.caseMode, "title");
    assert.strictEqual(intent.unique, false);
  });

  it("parses 店铺 as the column name", function () {
    const intent = parseExtractIntent("提取店铺列，并规范大小写与格式");
    assert.strictEqual(parseColumnName("提取店铺列，并规范大小写与格式"), "店铺");
    assert.strictEqual(intent.column, "店铺");
    assert.strictEqual(intent.unique, false);
  });

  it("does not treat 选中 as a column name", function () {
    assert.strictEqual(parseColumnName("提取选中列"), undefined);
  });

  it("parses 小写 and 去重 as operator params on the same extract ask", function () {
    const intent = parseExtractIntent("提取这一列改成小写并去重");
    assert.strictEqual(intent.caseMode, "lower");
    assert.strictEqual(intent.unique, true);
  });
});

describe("resolveContinuedAsk", function () {
  it("replays the previous ask only for a bare 继续", function () {
    assert.strictEqual(isContinueRequest("继续"), true);
    assert.strictEqual(
      resolveContinuedAsk("继续", ["提取选中列，并规范格式与大小写统一"]),
      "提取选中列，并规范格式与大小写统一"
    );
  });

  it("skips a chain of 继续", function () {
    assert.strictEqual(
      resolveContinuedAsk("继续", ["提取选中列", "继续"]),
      "提取选中列"
    );
  });

  it("does not rewrite 继续去重 — extra verbs stay for tools plus history", function () {
    assert.strictEqual(isContinueRequest("继续去重"), false);
    assert.strictEqual(
      resolveContinuedAsk("继续去重", ["提取店铺列，并规范大小写与格式"]),
      "继续去重"
    );
  });
});
