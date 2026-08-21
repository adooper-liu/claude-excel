require("ts-node/register/transpile-only");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseSkillMarkdown } = require("../../src/services/skill-md");
const { HANDLED_TOOLS } = require("../../src/services/skill-registry");
const { manifestToolNames } = require("../../src/services/operator-catalog");

const SKILL_PATH = path.join(
  __dirname,
  "../../../samples/packs/cross-border-ecommerce-finance/skills/finance-reconciliation/SKILL.md"
);

/** Core tools the finance SKILL handbook must name (user.* allowed separately). */
const REQUIRED_CORE_TOOLS = [
  "ensure_table",
  "reconcile_tables",
  "write_inputs",
  "write_to_sheet",
  "write_formula",
  "calculate_table",
  "create_pivot",
  "append_pack_audit",
  "format_range",
  "complete",
];

describe("finance-reconciliation SKILL handbook (Pack 化 P2)", function () {
  let raw;
  let parsed;

  before(function () {
    raw = fs.readFileSync(SKILL_PATH, "utf8");
    parsed = parseSkillMarkdown(raw);
  });

  it("frontmatter: name / slash / description", function () {
    assert.strictEqual(parsed.id, "finance-reconciliation");
    assert.strictEqual(parsed.slash, "跨境业财");
    assert.ok(parsed.title.length > 0);
    assert.ok(parsed.body.indexOf("编排") >= 0);
  });

  it("names every required core tool and all are registered", function () {
    const catalog = new Set(manifestToolNames());
    REQUIRED_CORE_TOOLS.forEach(function (name) {
      assert.ok(raw.indexOf(name) >= 0, "SKILL.md missing tool mention: " + name);
      assert.ok(HANDLED_TOOLS.has(name), name + " not in HANDLED_TOOLS");
      assert.ok(catalog.has(name), name + " not in operator catalog");
    });
  });

  it("does not invent run_flow(finance) or TS pre-orchestration", function () {
    assert.ok(!/\brun_flow\s*\(\s*\{[^}]*finance/i.test(raw));
    assert.ok(raw.indexOf("finance-run") < 0);
    assert.ok(raw.indexOf("isFinanceRequest") < 0);
  });

  it("has appendices A/B/C and G6 param cells B2–B10", function () {
    assert.ok(raw.indexOf("附录 A") >= 0);
    assert.ok(raw.indexOf("附录 B") >= 0);
    assert.ok(raw.indexOf("附录 C") >= 0);
    assert.ok(raw.indexOf("| B2 |") >= 0 && raw.indexOf("| B10 |") >= 0);
    assert.ok(raw.indexOf("假设参数!$B$3") >= 0);
  });

  it("audit step includes assumptionSnapshot and matchRate", function () {
    assert.ok(raw.indexOf("assumptionSnapshot") >= 0);
    assert.ok(raw.indexOf("matchRate") >= 0);
    assert.ok(raw.indexOf("append_pack_audit") >= 0);
  });

  it("conclusion template is three-part (口径/近似/风险)", function () {
    assert.ok(raw.indexOf("①") >= 0 || raw.indexOf("口径") >= 0);
    assert.ok(raw.indexOf("近似") >= 0);
    assert.ok(raw.indexOf("风险") >= 0);
  });
});
