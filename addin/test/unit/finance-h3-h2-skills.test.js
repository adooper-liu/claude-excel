require("ts-node/register/transpile-only");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { parseSkillMarkdown } = require("../../src/services/skill-md");

const PACK = path.join(
  __dirname,
  "../../../samples/packs/cross-border-ecommerce-finance"
);

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
  it("lists all three skills", function () {
    const pack = JSON.parse(
      fs.readFileSync(path.join(PACK, "pack.json"), "utf8")
    );
    assert.ok(pack.skills.indexOf("finance-reconciliation") >= 0);
    assert.ok(pack.skills.indexOf("finance-sensitivity") >= 0);
    assert.ok(pack.skills.indexOf("settlement-bank-recon") >= 0);
  });
});
