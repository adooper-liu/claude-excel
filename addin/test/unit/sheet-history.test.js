require("ts-node/register/transpile-only");
const assert = require("assert");
const { SheetHistory } = require("../../src/excel/sheet-history");

describe("SheetHistory", function () {
  it("pops the last created sheet first", function () {
    const h = new SheetHistory();
    h.push("订单", "Sheet1");
    h.push("对账结果", "订单");
    assert.deepStrictEqual(h.pop(), { sheet: "对账结果", previous: "订单" });
    assert.deepStrictEqual(h.pop(), { sheet: "订单", previous: "Sheet1" });
  });

  it("returns null when empty", function () {
    const h = new SheetHistory();
    assert.strictEqual(h.pop(), null);
    assert.strictEqual(h.length, 0);
    assert.strictEqual(h.peek(), null);
  });

  it("popIfTop only pops when the top sheet matches", function () {
    const h = new SheetHistory();
    h.push("订单", "Sheet1");
    h.push("汇总结果", "订单");
    assert.strictEqual(h.popIfTop("查找结果"), false);
    assert.strictEqual(h.peek().sheet, "汇总结果");
    assert.strictEqual(h.popIfTop("汇总结果"), true);
    assert.strictEqual(h.peek().sheet, "订单");
  });

  it("lists newest first and can remove a middle sheet", function () {
    const h = new SheetHistory();
    h.push("订单", "Sheet1");
    h.push("汇总结果", "订单");
    h.push("查找结果", "汇总结果");
    assert.deepStrictEqual(
      h.list().map((x) => x.sheet),
      ["查找结果", "汇总结果", "订单"]
    );
    assert.deepStrictEqual(h.remove("汇总结果"), { sheet: "汇总结果", previous: "订单" });
    assert.deepStrictEqual(
      h.list().map((x) => x.sheet),
      ["查找结果", "订单"]
    );
    assert.strictEqual(h.remove("没有"), null);
  });

  it("drops the oldest entry after 20", function () {
    const h = new SheetHistory(20);
    for (let i = 1; i <= 21; i++) h.push("S" + i, "prev");
    assert.strictEqual(h.length, 20);
    assert.strictEqual(h.peek().sheet, "S21");
    h.pop();
    const names = [];
    let item;
    while ((item = h.pop())) names.push(item.sheet);
    assert.strictEqual(names[names.length - 1], "S2");
    assert.ok(!names.includes("S1"));
  });
});
