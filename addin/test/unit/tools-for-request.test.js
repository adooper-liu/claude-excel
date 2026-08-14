require("ts-node/register/transpile-only");
const assert = require("assert");
const { selectToolsForRequest } = require("../../src/services/tools-for-request");

describe("selectToolsForRequest", function () {
  const tools = [
    { name: "inspect_workbook" },
    { name: "ensure_table" },
    { name: "reconcile_tables" },
    { name: "write_to_sheet" },
    { name: "write_to_range" },
  ];

  it("hides write tools for 对账 so the model cannot fake a result sheet", function () {
    const names = selectToolsForRequest("按订单号对账", tools).map((t) => t.name);
    assert.deepStrictEqual(names, ["inspect_workbook", "ensure_table", "reconcile_tables"]);
  });

  it("hides write tools for 去重 so the model cannot fake a result sheet", function () {
    const names = selectToolsForRequest("按订单号去重", tools.concat([{ name: "reshape_table" }])).map((t) => t.name);
    assert.ok(names.indexOf("reshape_table") >= 0);
    assert.ok(names.indexOf("write_to_sheet") < 0);
  });

  it("hides write tools for 求和 so the model cannot paste dead totals", function () {
    const names = selectToolsForRequest("按类别求和", tools.concat([{ name: "calculate_table" }])).map((t) => t.name);
    assert.ok(names.indexOf("calculate_table") >= 0);
    assert.ok(names.indexOf("write_to_sheet") < 0);
  });

  it("keeps write tools for other requests", function () {
    const names = selectToolsForRequest("把表头加粗", tools).map((t) => t.name);
    assert.ok(names.indexOf("write_to_sheet") >= 0);
  });

  it("keeps web_fetch for product lookup", function () {
    const withWeb = tools.concat([{ name: "web_fetch" }]);
    const names = selectToolsForRequest("获取产品数据", withWeb).map((t) => t.name);
    assert.ok(names.indexOf("web_fetch") >= 0);
  });

  it("hides web_fetch during 对账", function () {
    const withWeb = tools.concat([{ name: "web_fetch" }]);
    const names = selectToolsForRequest("按订单号对账", withWeb).map((t) => t.name);
    assert.ok(names.indexOf("web_fetch") < 0);
  });

  it("hides write tools when a native skill is active even if the ask is generic", function () {
    const names = selectToolsForRequest("请按技能说明处理当前工作簿。", tools, "reconcile").map((t) => t.name);
    assert.ok(names.indexOf("write_to_sheet") < 0);
  });

  it("limits /skill to inspect so creating a skill cannot rewrite the workbook", function () {
    const names = selectToolsForRequest("把流程做成技能", tools, "skillify").map((t) => t.name);
    assert.deepStrictEqual(names, ["inspect_workbook"]);
  });
});
