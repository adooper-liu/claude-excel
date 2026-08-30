require("ts-node/register/transpile-only");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseSkillMarkdown } = require("../../src/services/skill-md");
const { HANDLED_TOOLS } = require("../../src/services/skill-registry");
const { manifestToolNames } = require("../../src/services/operator-catalog");

const PACK = path.join(
  __dirname,
  "../../../samples/packs/cross-border-ecommerce-finance"
);
const SKILL_PATH = path.join(PACK, "skills/finance-pl/SKILL.md");

const REQUIRED_CORE_TOOLS = [
  "inspect_workbook",
  "inspect_table",
  "inspect_formulas",
  "write_to_sheet",
  "ensure_table",
  "write_formula",
  "format_range",
  "conditional_format",
  "scan_formula_errors",
  "read_range",
  "append_pack_audit",
  "complete",
];

describe("finance-pl SKILL", function () {
  let raw;
  let parsed;
  let pack;

  before(function () {
    raw = fs.readFileSync(SKILL_PATH, "utf8");
    parsed = parseSkillMarkdown(raw);
    pack = JSON.parse(fs.readFileSync(path.join(PACK, "pack.json"), "utf8"));
  });

  it("registers id finance-pl and slash 业财损益", function () {
    assert.strictEqual(parsed.id, "finance-pl");
    assert.strictEqual(parsed.slash, "业财损益");
    assert.ok(parsed.title.includes("P&L"));
  });

  it("pack 0.1.2 registers the user-side P&L skill", function () {
    assert.strictEqual(pack.version, "0.1.2");
    assert.ok(pack.skills.includes("finance-pl"));
  });

  it("only names registered core operators", function () {
    const catalog = new Set(manifestToolNames());
    REQUIRED_CORE_TOOLS.forEach(function (name) {
      assert.ok(raw.includes(name), "SKILL.md missing tool mention: " + name);
      assert.ok(HANDLED_TOOLS.has(name), name + " not in HANDLED_TOOLS");
      assert.ok(catalog.has(name), name + " not in operator catalog");
    });
  });

  it("uses live structured-reference summaries and forbids mental math", function () {
    assert.ok(raw.includes("=SUM('T_p'[收入])"));
    assert.ok(raw.includes("left_quantity"));
    assert.ok(raw.includes("left_item_price"));
    assert.ok(raw.includes("'假设参数'!$B$2"));
    assert.ok(raw.includes("不心算利润"));
    assert.ok(raw.includes("不写死结果"));
    assert.ok(!raw.includes("$E$2:$E$61"));
  });

  it("keeps reconciliation as the source pipeline and P&L as a summary layer", function () {
    assert.ok(raw.includes("/跨境业财"));
    assert.ok(raw.includes("T_finance_recon"));
    assert.ok(raw.includes("不发明第二套利润公式"));
    assert.ok(raw.includes("SUMIFS(left_item_price)"));
  });

  it("audits the run without inventing reconciliation counts", function () {
    assert.ok(raw.includes("append_pack_audit"));
    assert.ok(raw.includes("runType: \"finance-pl\""));
    assert.ok(raw.includes("assumptionSnapshot"));
    assert.ok(raw.includes("不要虚构匹配计数"));
  });

  it("returns the required three-part conclusion", function () {
    assert.ok(raw.includes("① 口径"));
    assert.ok(raw.includes("② 近似"));
    assert.ok(raw.includes("③ 风险"));
  });
});
