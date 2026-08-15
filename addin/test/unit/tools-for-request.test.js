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
    { name: "create_pivot" },
    { name: "write_inputs" },
    { name: "web_fetch" },
  ];

  it("hides write tools for 对账 so the model cannot fake a result sheet", function () {
    const names = selectToolsForRequest("按订单号对账", tools).map((t) => t.name);
    assert.ok(names.indexOf("reconcile_tables") >= 0);
    assert.ok(names.indexOf("write_to_sheet") < 0);
    assert.ok(names.indexOf("write_inputs") < 0);
    assert.ok(names.indexOf("web_fetch") < 0);
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

  it("hides write tools for 提取店铺列 so the model cannot dump the column through write_to_sheet", function () {
    const withExtract = tools.concat([{ name: "extract_selection" }]);
    const names = selectToolsForRequest("提取店铺列，并规范大小写与格式", withExtract).map((t) => t.name);
    assert.ok(names.indexOf("extract_selection") >= 0);
    assert.ok(names.indexOf("write_to_sheet") < 0);
  });

  it("keeps write tools for other requests", function () {
    const names = selectToolsForRequest("把表头加粗", tools).map((t) => t.name);
    assert.ok(names.indexOf("write_to_sheet") >= 0);
    assert.ok(names.indexOf("write_inputs") >= 0);
  });

  it("hides write tools for 透视 but keeps create_pivot", function () {
    const names = selectToolsForRequest("按客户透视", tools).map((t) => t.name);
    assert.ok(names.indexOf("create_pivot") >= 0);
    assert.ok(names.indexOf("write_to_sheet") < 0);
  });

  it("limits /假设 to write_inputs so formula cells cannot be overwritten with write_to_range", function () {
    const names = selectToolsForRequest("把增长率改成8%", tools.concat([{ name: "inspect_formulas" }]), "assume").map(
      (t) => t.name
    );
    assert.ok(names.indexOf("write_inputs") >= 0);
    assert.ok(names.indexOf("write_to_range") < 0);
    assert.ok(names.indexOf("write_to_sheet") < 0);
  });

  it("keeps web_fetch and write_to_sheet for /取数", function () {
    const names = selectToolsForRequest("从这个网址取数", tools, "fetch").map((t) => t.name);
    assert.ok(names.indexOf("web_fetch") >= 0);
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

  it("limits /skill-creator to inspect so creating a skill cannot rewrite the workbook", function () {
    const withInspect = tools.concat([
      { name: "inspect_table" },
      { name: "inspect_formulas" },
      { name: "scan_formula_errors" },
      { name: "format_range" },
    ]);
    const names = selectToolsForRequest("把流程做成技能", withInspect, "skill-creator").map((t) => t.name);
    assert.deepStrictEqual(names, [
      "inspect_workbook",
      "inspect_table",
      "inspect_formulas",
      "scan_formula_errors",
    ]);
  });

  it("limits /拆解 to inspect so mapping a workflow cannot rewrite the workbook", function () {
    const withInspect = tools.concat([
      { name: "inspect_table" },
      { name: "inspect_formulas" },
      { name: "scan_formula_errors" },
      { name: "write_to_sheet" },
    ]);
    const names = selectToolsForRequest("拆一下清关流程", withInspect, "deconstruct").map((t) => t.name);
    assert.ok(names.indexOf("inspect_workbook") >= 0);
    assert.ok(names.indexOf("write_to_sheet") < 0);
  });
});
