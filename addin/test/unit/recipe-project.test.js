require("ts-node/register/transpile-only");
const assert = require("assert");
const { normalizeColumns } = require("../../src/excel/recipe-project");

describe("recipe-project normalizeColumns", function () {
  it("drops __ prefixed audit columns from the default project mapping", function () {
    const columns = normalizeColumns([
      { as: "sku", from: "platform_sku" },
      { as: "review", from: "__review" },
      { as: "__match_mode", from: "something" },
      { as: "amt", from: 3 },
    ]);
    assert.deepStrictEqual(columns, [
      { as: "sku", from: "platform_sku" },
      { as: "amt", from: 3 },
    ]);
  });

  it("keeps non-__ merge and coerce specs", function () {
    const columns = normalizeColumns([
      { as: "售价", merge: [4, 5, 6], separator: "", coerce: "number" },
      { as: "标题", from: "title" },
    ]);
    assert.deepStrictEqual(columns, [
      { as: "售价", merge: [4, 5, 6], separator: "", coerce: "number" },
      { as: "标题", from: "title" },
    ]);
  });
});
