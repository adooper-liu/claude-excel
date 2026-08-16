require("ts-node/register/transpile-only");
const assert = require("assert");
const { HANDLED_TOOLS } = require("../../src/services/skill-registry");
const {
  buildOperatorCatalog,
  manifestToolNames,
  operatorCatalogByGroup,
  userSkillOperatorCatalog,
} = require("../../src/services/operator-catalog");

describe("operator-catalog", function () {
  it("lists every manifest tool exactly once", function () {
    const names = manifestToolNames();
    assert.ok(names.length >= 20);
    assert.strictEqual(new Set(names).size, names.length);
  });

  it("every catalog entry is a handled executor", function () {
    buildOperatorCatalog().forEach(function (e) {
      assert.ok(HANDLED_TOOLS.has(e.name), e.name + " missing from HANDLED_TOOLS");
    });
  });

  it("every HANDLED_TOOLS name appears in the catalog", function () {
    const names = new Set(manifestToolNames());
    HANDLED_TOOLS.forEach(function (n) {
      assert.ok(names.has(n), n + " missing from operator catalog");
    });
  });

  it("user skill catalog excludes low-level read/write helpers", function () {
    const names = userSkillOperatorCatalog().map(function (e) {
      return e.name;
    });
    assert.ok(names.indexOf("extract_selection") >= 0);
    assert.ok(names.indexOf("reshape_table") >= 0);
    assert.ok(names.indexOf("read_range") < 0);
    assert.ok(names.indexOf("write_to_range") < 0);
  });

  it("groups align with manifest modules", function () {
    const groups = operatorCatalogByGroup(true);
    assert.ok(groups.some(function (g) {
      return g.id === "reshape" && g.items.some(function (i) {
        return i.name === "reshape_table";
      });
    }));
    assert.ok(groups.some(function (g) {
      return g.label === "读结构";
    }));
  });

  it("reshape_table hint mentions project", function () {
    const row = buildOperatorCatalog().find(function (e) {
      return e.name === "reshape_table";
    });
    assert.ok(row);
    assert.match(row.hint, /project/);
  });
});
