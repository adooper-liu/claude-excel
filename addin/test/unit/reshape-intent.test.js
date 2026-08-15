require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  isReshapeRequest,
  parseReshapeIntent,
  pickSourceSheet,
} = require("../../src/excel/reshape-intent");

describe("isReshapeRequest", function () {
  it("matches 按订单号去重", function () {
    assert.strictEqual(isReshapeRequest("按订单号去重"), true);
  });

  it("does not steal 对账", function () {
    assert.strictEqual(isReshapeRequest("按订单号对账"), false);
  });

  it("does not treat 规整列 as dedupe-style shortcut", function () {
    assert.strictEqual(isReshapeRequest("整理成规整列"), false);
  });
});

describe("isProjectReshapeRequest", function () {
  const { isProjectReshapeRequest } = require("../../src/excel/reshape-intent");
  it("matches 规整列 asks", function () {
    assert.strictEqual(isProjectReshapeRequest("整理成规整列（排名/标题）"), true);
  });
});

describe("parseReshapeIntent", function () {
  it("parses 按订单号去重", function () {
    assert.deepStrictEqual(parseReshapeIntent("按订单号去重"), {
      op: "dedupe",
      keys: ["订单号"],
    });
  });

  it("parses 反透视", function () {
    assert.strictEqual(parseReshapeIntent("把月份反透视").op, "unpivot");
  });

  it("parses split column and separator", function () {
    const intent = parseReshapeIntent("把标签按逗号拆开");
    assert.strictEqual(intent.op, "split");
    assert.strictEqual(intent.column, "标签");
    assert.strictEqual(intent.separator, ",");
  });

  it("parses coerce to number", function () {
    const intent = parseReshapeIntent("把金额转成数字");
    assert.strictEqual(intent.op, "coerce");
    assert.strictEqual(intent.column, "金额");
    assert.strictEqual(intent.type, "number");
  });

  it("parses project for 规整列", function () {
    assert.strictEqual(parseReshapeIntent("整理成规整列").op, "project");
  });
});

describe("pickSourceSheet", function () {
  it("skips previous result sheets and empty sheets", function () {
    const picked = pickSourceSheet(
      [
        { name: "Sheet1", rows: 0, headers: [], tableNames: [], range: null },
        { name: "订单", rows: 6, headers: ["订单号", "金额"], tableNames: [], range: "A1:B6" },
        { name: "去重结果", rows: 4, headers: ["订单号"], tableNames: [], range: "A1:A4" },
      ],
      { op: "dedupe", keys: ["订单号"] }
    );
    assert.strictEqual(picked.name, "订单");
  });

  it("returns null when there is no headed table", function () {
    assert.strictEqual(
      pickSourceSheet(
        [{ name: "Sheet1", rows: 0, headers: [], tableNames: [], range: null }],
        { op: "unpivot" }
      ),
      null
    );
  });
});
