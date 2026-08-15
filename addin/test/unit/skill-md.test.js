require("ts-node/register/transpile-only");
const assert = require("assert");
const { parseSkillMarkdown, reservedSkillId, extractSkillMarkdown } = require("../../src/services/skill-md");
const { mergeSlashSkills, filterSlashSkills, parseSlashCommand } = require("../../src/services/slash-skills");

const SAMPLE = `---
name: monthly-close
description: 把本月流水做成对账底稿。用户说月结、关账时使用。
slash: 月结
---

# 月结

1. inspect_workbook
2. 不要覆盖源表
`;

describe("parseSkillMarkdown", function () {
  it("reads Claude-style SKILL.md frontmatter", function () {
    const s = parseSkillMarkdown(SAMPLE);
    assert.strictEqual(s.id, "monthly-close");
    assert.strictEqual(s.slash, "月结");
    assert.ok(s.title.indexOf("对账底稿") >= 0);
    assert.ok(s.body.indexOf("inspect_workbook") >= 0);
    assert.ok(s.body.indexOf("name:") < 0);
  });

  it("rejects a file without name and description", function () {
    assert.throws(function () {
      parseSkillMarkdown("# just a note");
    }, /name|description/);
  });

  it("rejects reserved builtin ids", function () {
    assert.strictEqual(reservedSkillId("reconcile"), true);
    assert.strictEqual(reservedSkillId("规范"), true);
    assert.strictEqual(reservedSkillId("skill-creator"), true);
    assert.strictEqual(reservedSkillId("透视"), true);
    assert.strictEqual(reservedSkillId("假设"), true);
    assert.strictEqual(reservedSkillId("拆解"), true);
    assert.throws(function () {
      parseSkillMarkdown("---\nname: 对账\ndescription: x\n---\nbody");
    }, /内置/);
  });
});

describe("extractSkillMarkdown", function () {
  it("pulls a fenced SKILL.md out of a model reply", function () {
    const reply = "可以。\n\n```markdown\n" + SAMPLE + "```\n";
    const md = extractSkillMarkdown(reply);
    assert.ok(md);
    assert.strictEqual(parseSkillMarkdown(md).slash, "月结");
  });

  it("returns null when the reply is not a skill", function () {
    assert.strictEqual(extractSkillMarkdown("直接用 /对账 即可。"), null);
  });
});

describe("installed slash skills", function () {
  const extra = [
    {
      id: "monthly-close",
      slash: "月结",
      title: "月结底稿",
      body: "inspect then write a new sheet",
    },
  ];

  it("lists installed skills after builtins", function () {
    const names = mergeSlashSkills(extra).map((s) => s.slash);
    assert.deepStrictEqual(names.slice(0, 3), ["对账", "整形", "计算"]);
    assert.ok(names.indexOf("月结") >= 0);
  });

  it("does not let an install steal /对账", function () {
    const names = mergeSlashSkills([{ id: "x", slash: "对账", title: "steal", body: "no" }]).map(
      (s) => s.slash
    );
    assert.strictEqual(names.filter((n) => n === "对账").length, 1);
  });

  it("parses /月结 using the installed catalog", function () {
    assert.deepStrictEqual(parseSlashCommand("/月结", extra), { id: "monthly-close", extra: "" });
    assert.ok(filterSlashSkills("月", extra).some((s) => s.slash === "月结"));
  });
});
