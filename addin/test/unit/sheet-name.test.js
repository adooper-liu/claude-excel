require("ts-node/register/transpile-only");
const assert = require("assert");
const { nextSheetName } = require("../../src/excel/sheet-name");

describe("nextSheetName", function () {
  it("keeps the base when free", function () {
    assert.strictEqual(nextSheetName("取数_sst.aosom.cloud", ["Sheet1"]), "取数_sst.aosom.cloud");
  });

  it("suffixes 2 when the base is taken", function () {
    assert.strictEqual(nextSheetName("取数_sst.aosom.cloud", ["取数_sst.aosom.cloud"]), "取数_sst.aosom.cloud2");
  });
});
