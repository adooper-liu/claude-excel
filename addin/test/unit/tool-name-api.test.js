require("ts-node/register/transpile-only");
const assert = require("assert");
const { toApiToolName, fromApiToolName, mapToolsForApi } = require("../../src/services/tool-name-api");

describe("tool-name-api", function () {
  it("maps user.* dots to underscores for API", function () {
    assert.strictEqual(toApiToolName("user.profit_assumptions"), "user_profit_assumptions");
    assert.strictEqual(toApiToolName("user.connector_load_feed"), "user_connector_load_feed");
    assert.strictEqual(toApiToolName("reconcile_tables"), "reconcile_tables");
  });

  it("restores user_* back to user.* for execution", function () {
    assert.strictEqual(fromApiToolName("user_profit_assumptions"), "user.profit_assumptions");
    assert.strictEqual(fromApiToolName("user_connector_load_feed"), "user.connector_load_feed");
    assert.strictEqual(fromApiToolName("write_to_sheet"), "write_to_sheet");
  });

  it("roundtrips through mapToolsForApi", function () {
    const mapped = mapToolsForApi([
      { name: "user.profit_assumptions", description: "x", input_schema: { type: "object", properties: {} } },
    ]);
    assert.strictEqual(mapped[0].name, "user_profit_assumptions");
    assert.match(mapped[0].name, /^[a-zA-Z0-9_-]+$/);
  });
});
