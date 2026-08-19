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
  it("lists product skills plus /skill-creator", function () {
    const names = SLASH_SKILLS.map((s) => s.slash);
    assert.deepStrictEqual(names, ["对账", "整形", "计算", "计算器", "透视", "假设", "取数", "调研", "知识", "规范", "拆解", "skill-creator"]);
  });

  it("treats a leading slash with no space as a query", function () {
    assert.strictEqual(slashQuery("/"), "");
    assert.strictEqual(slashQuery("/对"), "对");
    assert.strictEqual(slashQuery("/skill-creator"), "skill-creator");
    assert.strictEqual(slashQuery("/skill"), "skill");
    assert.strictEqual(slashQuery("对账"), null);
    assert.strictEqual(slashQuery("/对账 按客户"), null);
  });

  it("filters by slash or title; /skills shows all", function () {
    assert.ok(filterSlashSkills("对").some((s) => s.slash === "对账"));
    assert.ok(filterSlashSkills("skill").some((s) => s.slash === "skill-creator"));
    assert.ok(filterSlashSkills("skill").every((s) => /skill/i.test(s.slash + s.title + s.id)));
    assert.strictEqual(filterSlashSkills("加粗").length, 0);
  });

  it("shows full catalog on a bare slash", function () {
    assert.strictEqual(filterSlashSkills("").length, SLASH_SKILLS.length);
    assert.strictEqual(filterSlashSkills("skills").length, SLASH_SKILLS.length);
  });

  it("talk examples are plain asks, not slash commands", function () {
    const { TALK_EXAMPLES } = require("../../src/services/slash-skills");
    assert.ok(TALK_EXAMPLES.length >= 3);
    TALK_EXAMPLES.forEach(function (ask) {
      assert.ok(ask && ask.charAt(0) !== "/");
    });
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

  it("parses /skill-creator, with /skill as an alias", function () {
    assert.deepStrictEqual(parseSlashCommand("/skill-creator"), { id: "skill-creator", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/skill"), { id: "skill-creator", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/skill-creator 月结关账"), {
      id: "skill-creator",
      extra: "月结关账",
    });
    assert.deepStrictEqual(parseSlashCommand("/创建技能"), { id: "skill-creator", extra: "" });
  });

  it("maps 规范 plus aliases", function () {
    assert.deepStrictEqual(parseSlashCommand("/规范"), { id: "craft", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/体检"), { id: "craft", extra: "检查公式错误" });
  });

  it("maps 透视 / 假设 / 取数", function () {
    assert.deepStrictEqual(parseSlashCommand("/透视"), { id: "pivot", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/假设"), { id: "assume", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/情景"), { id: "assume", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/取数 https://example.com"), {
      id: "fetch",
      extra: "https://example.com",
    });
  });

  it("maps /拆解", function () {
    assert.deepStrictEqual(parseSlashCommand("/拆解"), { id: "deconstruct", extra: "" });
    assert.deepStrictEqual(parseSlashCommand("/工作流 清关对账"), {
      id: "deconstruct",
      extra: "清关对账",
    });
    assert.ok(skillAsk("deconstruct").indexOf("不替用户拍板") >= 0);
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
      title: "按条件求和 / 匹配数据 / 修 #REF!，公式活的",
    });
    assert.strictEqual(slashDisplay("按类别求和"), null);
  });

  it("skillAsk for fetch keeps picking on the web page", function () {
    const ask = skillAsk("fetch");
    assert.ok(ask.indexOf("点选") >= 0);
    assert.ok(ask.indexOf("不必每次回到 Excel") >= 0);
    assert.ok(ask.indexOf("/调研") >= 0);
  });

  it("parseSlashCommand maps 调研 to research", function () {
    assert.deepStrictEqual(parseSlashCommand("/调研 欧盟 VAT"), { id: "research", extra: "欧盟 VAT" });
    assert.deepStrictEqual(parseSlashCommand("/查资料"), { id: "research", extra: "" });
  });

  it("skillAsk does not hardcode 订单号 or 类别", function () {
    const ask = skillAsk("reconcile") + skillAsk("reshape") + skillAsk("calculate");
    assert.ok(ask.indexOf("订单号") < 0);
    assert.ok(ask.indexOf("类别") < 0);
  });

  it("skillAsk for /skill-creator asks to draft SKILL.md without assuming 订单号", function () {
    const ask = skillAsk("skill-creator", "每月关账");
    assert.ok(ask.indexOf("SKILL.md") >= 0);
    assert.ok(ask.indexOf("每月关账") >= 0);
    assert.ok(ask.indexOf("Office JS") >= 0);
    assert.ok(ask.indexOf("订单号") < 0);
  });
});
