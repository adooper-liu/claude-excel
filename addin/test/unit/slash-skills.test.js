require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  SLASH_SKILLS,
  slashQuery,
  filterSlashSkills,
  parseSlashCommand,
  skillAsk,
  slashDisplay,
} = require("../../src/services/slash-skills");

describe("slash-skills", function () {
  it("lists product skills plus /skill to create one", function () {
    const names = SLASH_SKILLS.map((s) => s.slash);
    assert.deepStrictEqual(names, ["对账", "整形", "计算", "skill"]);
  });

  it("treats a leading slash with no space as a query", function () {
    assert.strictEqual(slashQuery("/"), "");
    assert.strictEqual(slashQuery("/对"), "对");
    assert.strictEqual(slashQuery("/skill"), "skill");
    assert.strictEqual(slashQuery("对账"), null);
    assert.strictEqual(slashQuery("/对账 按客户"), null);
  });

  it("filters by slash or title; /skills shows all", function () {
    assert.ok(filterSlashSkills("对").some((s) => s.slash === "对账"));
    assert.ok(filterSlashSkills("skill").some((s) => s.slash === "skill"));
    assert.ok(filterSlashSkills("skill").every((s) => s.slash === "skill" || /skill/i.test(s.title + s.id)));
    assert.strictEqual(filterSlashSkills("skills").length, SLASH_SKILLS.length);
    assert.strictEqual(filterSlashSkills("加粗").length, 0);
  });

  it("parses a skill without assuming 订单号", function () {
    assert.deepStrictEqual(parseSlashCommand("/对账"), { id: "reconcile", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/对账 按客户编号"), {
      id: "reconcile",
      extra: "按客户编号",
    });
    assert.strictEqual(parseSlashCommand("/skills"), null);
    assert.strictEqual(parseSlashCommand("按订单号对账"), null);
  });

  it("parses /skill as create-skill, with an optional workflow", function () {
    assert.deepStrictEqual(parseSlashCommand("/skill"), { id: "skillify", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/skill 月结关账"), {
      id: "skillify",
      extra: "月结关账",
    });
    assert.deepStrictEqual(parseSlashCommand("/创建技能"), { id: "skillify", extra: "" });
  });

  it("maps op aliases onto the parent skill without canned schema", function () {
    assert.deepStrictEqual(parseSlashCommand("/去重"), { id: "reshape", extra: "去重" });
    assert.deepStrictEqual(parseSlashCommand("/求和"), { id: "calculate", extra: "求和" });
  });

  it("slashDisplay keeps the typed token for chat highlight", function () {
    assert.deepStrictEqual(slashDisplay("/对账"), {
      token: "对账",
      extra: "",
      title: "两表精确对账，只写新表",
    });
    assert.deepStrictEqual(slashDisplay("/计算 按类别求和"), {
      token: "计算",
      extra: "按类别求和",
      title: "活公式：SUMIFS / INDEX+MATCH / 修 #REF!",
    });
    assert.strictEqual(slashDisplay("按类别求和"), null);
  });

  it("skillAsk does not hardcode 订单号 or 类别", function () {
    const ask = skillAsk("reconcile") + skillAsk("reshape") + skillAsk("calculate");
    assert.ok(ask.indexOf("订单号") < 0);
    assert.ok(ask.indexOf("类别") < 0);
  });

  it("skillAsk for /skill asks to draft SKILL.md without assuming 订单号", function () {
    const ask = skillAsk("skillify", "每月关账");
    assert.ok(ask.indexOf("SKILL.md") >= 0);
    assert.ok(ask.indexOf("每月关账") >= 0);
    assert.ok(ask.indexOf("订单号") < 0);
  });
});
