require("ts-node/register/transpile-only");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { CORE_SKILL_MANIFESTS } = require("../../src/services/skill-manifests");
const { HANDLED_TOOLS } = require("../../src/services/skill-registry");

describe("skill registry integrity", function () {
  const handlerSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "services", "skill-handlers.ts"),
    "utf8"
  );
  const toolNames = CORE_SKILL_MANIFESTS.flatMap(function (m) {
    return (m.tools || []).map(function (t) {
      return t.name;
    });
  });

  it("every core manifest tool is a handled executor", function () {
    const missing = toolNames.filter(function (n) {
      return !HANDLED_TOOLS.has(n);
    });
    assert.deepStrictEqual(missing, []);
  });

  it("every core manifest tool has an executeHandler case (no silent Unknown tool)", function () {
    const missing = toolNames.filter(function (n) {
      return handlerSource.indexOf("case '" + n + "'") < 0;
    });
    assert.deepStrictEqual(missing, []);
  });

  it("build_dashboard is registered end to end", function () {
    assert.ok(HANDLED_TOOLS.has("build_dashboard"));
    assert.ok(toolNames.indexOf("build_dashboard") >= 0);
    assert.ok(handlerSource.indexOf("case 'build_dashboard'") >= 0);
  });
});
