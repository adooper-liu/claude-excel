require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  sanitizeTableName,
  parseA1Range,
  resolveTableName,
} = require("../../src/excel/table-name");

describe("sanitizeTableName", function () {
  it("prefixes ASCII letter when name starts with CJK", function () {
    const name = sanitizeTableName("系统订单表");
    assert.match(name, /^[A-Za-z_]/);
    assert.ok(name.indexOf("系统订单表") >= 0);
  });

  it("keeps names that already start with a letter", function () {
    assert.strictEqual(sanitizeTableName("Orders"), "Orders");
  });

  it("prefixes when name starts with a digit", function () {
    assert.match(sanitizeTableName("1abc"), /^_/);
  });
});

describe("parseA1Range", function () {
  it("strips sheet prefix and $", function () {
    assert.strictEqual(parseA1Range("'系统订单'!$A$1:$D$6"), "A1:D6");
  });

  it("keeps a plain A1 range", function () {
    assert.strictEqual(parseA1Range("A1:C10"), "A1:C10");
  });
});

describe("resolveTableName", function () {
  it("maps a Chinese request to the T_ prefixed Excel name", function () {
    assert.strictEqual(
      resolveTableName("系统订单表", ["T_系统订单表", "T_银行流水表"]),
      "T_系统订单表"
    );
  });

  it("returns exact match when present", function () {
    assert.strictEqual(resolveTableName("Orders", ["Orders", "T_系统订单表"]), "Orders");
  });
});
