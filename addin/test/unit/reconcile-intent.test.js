require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  isReconcileRequest,
  parseKeyFromText,
  pickSourceSheets,
  inferKeys,
} = require("../../src/excel/reconcile-intent");

describe("isReconcileRequest", function () {
  it("matches 按订单号对账", function () {
    assert.strictEqual(isReconcileRequest("按订单号对账"), true);
  });

  it("does not match a follow-up about the result sheet", function () {
    assert.strictEqual(isReconcileRequest("解释一下对账结果"), false);
  });
});

describe("parseKeyFromText", function () {
  it("extracts 订单号", function () {
    assert.strictEqual(parseKeyFromText("按订单号对账"), "订单号");
  });
});

describe("pickSourceSheets", function () {
  it("skips empty sheets and previous 对账结果", function () {
    const picked = pickSourceSheets(
      [
        { name: "Sheet1", rows: 0, headers: [], tableNames: [], range: null },
        { name: "系统订单", rows: 6, headers: ["订单号", "金额"], tableNames: [], range: "A1:B6" },
        { name: "银行流水", rows: 6, headers: ["订单号", "金额"], tableNames: [], range: "A1:B6" },
        { name: "对账结果", rows: 8, headers: ["订单号", "对账状态"], tableNames: [], range: "A1:B8" },
      ],
      "订单号"
    );
    assert.deepStrictEqual(picked.map((s) => s.name), ["系统订单", "银行流水"]);
  });
});

describe("inferKeys", function () {
  it("uses the key from the user text when both tables have it", function () {
    assert.deepStrictEqual(
      inferKeys("按订单号对账", ["订单号", "金额"], ["订单号", "到账日期"]),
      ["订单号"]
    );
  });
});
