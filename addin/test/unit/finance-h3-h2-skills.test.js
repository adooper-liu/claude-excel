require("ts-node/register/transpile-only");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseSkillMarkdown } = require("../../src/services/skill-md");

const PACK = path.join(
  __dirname,
  "../../../samples/packs/cross-border-ecommerce-finance"
);
const REPO = path.join(__dirname, "../../..");

describe("H3 finance-sensitivity SKILL", function () {
  const raw = fs.readFileSync(
    path.join(PACK, "skills/finance-sensitivity/SKILL.md"),
    "utf8"
  );
  const parsed = parseSkillMarkdown(raw);

  it("frontmatter slash 业财敏感性", function () {
    assert.strictEqual(parsed.id, "finance-sensitivity");
    assert.strictEqual(parsed.slash, "业财敏感性");
  });

  it("orchestrates write_inputs + sort_filter + append_pack_audit", function () {
    assert.ok(raw.indexOf("write_inputs") >= 0);
    assert.ok(raw.indexOf("sort_filter") >= 0);
    assert.ok(raw.indexOf("append_pack_audit") >= 0);
    assert.ok(raw.indexOf("finance-sensitivity") >= 0);
    assert.ok(raw.indexOf("退款率+4pp") >= 0);
  });

  it("runs five default levels and restores the original input after every level", function () {
    ["-10%", "-5%", "0%", "+5%", "+10%"].forEach(function (level) {
      assert.ok(raw.indexOf(level) >= 0, `missing level ${level}`);
    });
    assert.match(raw, /每档[\s\S]*write_inputs[\s\S]*read_range[\s\S]*write_inputs[\s\S]*还原原值/);
    assert.ok(raw.indexOf("不还原参数") < 0);
  });

  it("writes a dedicated matrix and audits scenarios without fake reconciliation metrics", function () {
    assert.ok(raw.indexOf("H3_敏感性_<参数中文名>") >= 0);
    assert.ok(raw.indexOf("write_to_sheet") >= 0);
    assert.ok(raw.indexOf("format_range") >= 0);
    assert.match(raw, /note:\s*"scenarios=/);
    assert.ok(raw.indexOf("assumptionSnapshot") >= 0);
    ["matched:", "leftOnly:", "rightOnly:", "conflict:", "matchRate:"].forEach(function (field) {
      assert.ok(raw.indexOf(field) < 0, `must not fabricate ${field}`);
    });
  });
});

describe("H2 settlement-bank-recon SKILL", function () {
  const raw = fs.readFileSync(
    path.join(PACK, "skills/settlement-bank-recon/SKILL.md"),
    "utf8"
  );
  const parsed = parseSkillMarkdown(raw);

  it("frontmatter slash 结算对账", function () {
    assert.strictEqual(parsed.id, "settlement-bank-recon");
    assert.strictEqual(parsed.slash, "结算对账");
  });

  it("documents date_window default 3 and exact settlement_id mode", function () {
    assert.ok(raw.indexOf("dateWindowDays") >= 0);
    assert.ok(raw.indexOf("date_window") >= 0);
    assert.ok(/\b3\b/.test(raw));
    assert.ok(raw.indexOf("settlement_id") >= 0);
    assert.ok(raw.indexOf('matchMode: "exact"') >= 0 || raw.indexOf("matchMode: exact") >= 0);
  });

  it("loads settlement and bank feeds", function () {
    assert.ok(raw.indexOf('feed: "settlement"') >= 0);
    assert.ok(raw.indexOf('feed: "bank"') >= 0);
  });
});

describe("finance pack.json H3/H2 skills", function () {
  it("publishes H3 in pack 0.1.3 and lists all three finance workflows", function () {
    const pack = JSON.parse(
      fs.readFileSync(path.join(PACK, "pack.json"), "utf8")
    );
    assert.strictEqual(pack.version, "0.1.3");
    assert.ok(pack.skills.indexOf("finance-reconciliation") >= 0);
    assert.ok(pack.skills.indexOf("finance-sensitivity") >= 0);
    assert.ok(pack.skills.indexOf("settlement-bank-recon") >= 0);
  });
});

describe("Gate 1b H3 documentation", function () {
  const gate = fs.readFileSync(path.join(REPO, "docs/gate-1b-mvp-closed-loop.md"), "utf8");
  const profitFormula = fs.readFileSync(path.join(PACK, "knowledge/profit_formula.md"), "utf8");

  it("marks the four-part MVP done and defines all H3 sections", function () {
    assert.ok(gate.indexOf("MVP 4 段 done，H3 立项中") >= 0);
    for (let section = 1; section <= 8; section += 1) {
      assert.match(gate, new RegExp(`^### 7\\.${section}\\s`, "m"));
    }
  });

  it("keeps the five default sensitivity levels in the profit-model source of truth", function () {
    assert.match(profitFormula, /^## 六、H3 档位默认值/m);
    ["-10%", "-5%", "0%", "+5%", "+10%"].forEach(function (level) {
      assert.ok(profitFormula.indexOf(level) >= 0, `missing knowledge level ${level}`);
    });
    assert.ok(profitFormula.indexOf("最多 5 档") >= 0);
  });
});
