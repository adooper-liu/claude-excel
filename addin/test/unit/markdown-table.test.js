require("ts-node/register/transpile-only");
const assert = require("assert");
const { extractMarkdownTable } = require("../../src/services/markdown-table");

describe("extractMarkdownTable", function () {
  it("pulls a markdown table out of a JSON tool result", function () {
    const raw = JSON.stringify({
      sheet: "订单",
      markdown: "| Row | 订单号 |\n| --- | --- |\n| 1 | A001 |\n| 2 | A002 |",
    });
    const table = extractMarkdownTable(raw);
    assert.ok(table);
    assert.ok(table.indexOf("订单号") >= 0);
    assert.ok(table.indexOf("A001") >= 0);
  });

  it("returns null when there is no table", function () {
    assert.strictEqual(extractMarkdownTable('{"outputSheet":"汇总结果"}'), null);
    assert.strictEqual(extractMarkdownTable(""), null);
  });
});
