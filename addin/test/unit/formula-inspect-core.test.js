require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  classifyCell,
  classifyGrid,
  colorRuns,
  cellA1,
  indexToCol,
  isCrossSheetFormula,
  isExcelErrorValue,
  isExternalLinkFormula,
  quoteSheetName,
  summarizeGrid,
  MODEL_COLORS,
} = require("../../src/excel/formula-inspect-core");
const {
  listPalettes,
  resolveNumberPreset,
  resolvePalette,
  PALETTES,
} = require("../../src/excel/style-core");

describe("formula-inspect-core", function () {
  it("classifies inputs, labels, formulas, cross-sheet, and errors", function () {
    assert.strictEqual(classifyCell("", 12), "input");
    assert.strictEqual(classifyCell("", "12.5"), "input");
    assert.strictEqual(classifyCell("", "订单号"), "label");
    assert.strictEqual(classifyCell("", ""), "empty");
    assert.strictEqual(classifyCell("=A1+B1", 3), "formula");
    assert.strictEqual(classifyCell("=Sheet2!A1", 3), "cross_sheet");
    assert.strictEqual(classifyCell("='假设输入'!$B$5", 1), "cross_sheet");
    assert.strictEqual(classifyCell("=A1/B1", "#DIV/0!"), "error");
    assert.strictEqual(classifyCell("", "#N/A", "Error"), "error");
  });

  it("detects sheet refs and external links without treating IF as cross-sheet", function () {
    assert.strictEqual(isCrossSheetFormula("=IF(A1>0,1,0)"), false);
    assert.strictEqual(isCrossSheetFormula("=Q1实际!B2"), true);
    assert.strictEqual(isExternalLinkFormula("=SUM(A1:A3)"), false);
    assert.strictEqual(isExternalLinkFormula("=[流水.xlsx]Sheet1!A1"), true);
  });

  it("recognizes Excel error tokens", function () {
    assert.ok(isExcelErrorValue("#REF!"));
    assert.ok(isExcelErrorValue("#NAME?"));
    assert.ok(isExcelErrorValue("#DIV/0!"));
    assert.ok(!isExcelErrorValue("N/A"));
    assert.ok(!isExcelErrorValue(0));
  });

  it("builds A1 addresses and quotes sheet names that need it", function () {
    assert.strictEqual(indexToCol(0), "A");
    assert.strictEqual(indexToCol(25), "Z");
    assert.strictEqual(indexToCol(26), "AA");
    assert.strictEqual(cellA1(5, 3, 0, 0), "C5");
    assert.strictEqual(cellA1(5, 3, 1, 1), "D6");
    assert.strictEqual(quoteSheetName("Sheet1"), "Sheet1");
    assert.strictEqual(quoteSheetName("假设输入"), "'假设输入'");
    assert.strictEqual(quoteSheetName("Q1 Actual"), "'Q1 Actual'");
    assert.strictEqual(quoteSheetName("O'Brien"), "'O''Brien'");
  });

  it("summarizes a small grid and caps error hits", function () {
    const formulas = [
      ["h1", "h2"],
      ["", "=A2+1"],
      ["", "=Other!A1"],
      ["", "=1/0"],
    ];
    const values = [
      ["h1", "h2"],
      [10, 11],
      [0, 4],
      [0, "#DIV/0!"],
    ];
    const s = summarizeGrid(formulas, values, { startRow1: 1, startCol1: 1, skipHeader: true, maxErrors: 10 });
    assert.strictEqual(s.inputs, 3);
    assert.strictEqual(s.formulas, 1);
    assert.strictEqual(s.crossSheet, 1);
    assert.strictEqual(s.errors, 1);
    assert.strictEqual(s.errorHits[0].a1, "B4");
    assert.ok(s.formulaSample.some((x) => x.formula === "=A2+1"));
    assert.ok(s.formulaSample.some((x) => x.kind === "cross_sheet"));
    assert.ok(s.inputSample.some((x) => x.a1 === "A2" && x.kind === "input"));
  });

  it("groups consecutive same-class cells into color runs", function () {
    const grid = classifyGrid(
      [
        ["h", "h", "h"],
        ["", "=A2", "=Sheet2!A1"],
        [12, 13, ""],
      ],
      [
        ["h", "h", "h"],
        [1, 2, 3],
        [12, 13, ""],
      ],
      { skipHeader: true }
    );
    const runs = colorRuns(grid, MODEL_COLORS);
    assert.ok(runs.some((r) => r.row === 1 && r.startCol === 1 && r.endCol === 1 && r.color === MODEL_COLORS.formula));
    assert.ok(runs.some((r) => r.row === 1 && r.startCol === 2 && r.color === MODEL_COLORS.cross_sheet));
    const inputRun = runs.find((r) => r.row === 2 && r.color === MODEL_COLORS.input);
    assert.ok(inputRun);
    assert.strictEqual(inputRun.startCol, 0);
    assert.strictEqual(inputRun.endCol, 1);
  });
});

describe("style-core palettes", function () {
  it("lists five in-product palettes with original names", function () {
    const names = listPalettes().map((p) => p.name);
    assert.deepStrictEqual(names, ["墨青", "暖砂", "霜白", "夜航", "朱砂"]);
    assert.ok(!names.join("").includes("Ocean"));
    assert.strictEqual(PALETTES.moqing.headerFill, "#1F4E5F");
  });

  it("resolves palette by id or Chinese name", function () {
    assert.strictEqual(resolvePalette("墨青").id, "moqing");
    assert.strictEqual(resolvePalette("yehang").name, "夜航");
    assert.throws(() => resolvePalette(""), /未指定/);
    assert.throws(() => resolvePalette("Ocean Depths"), /未知配色/);
  });

  it("resolves number presets including Chinese aliases", function () {
    assert.ok(resolveNumberPreset("percent").format.indexOf("%") >= 0);
    assert.ok(resolveNumberPreset("人民币").format.indexOf("¥") >= 0);
    assert.strictEqual(resolveNumberPreset("yuan").id, "yuan");
  });
});
