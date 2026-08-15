require("ts-node/register/transpile-only");
const assert = require("assert");
const { HANDLED_TOOLS } = require("../../src/services/skill-registry");
const {
  SKILL_TOOL_CATALOG,
  skillCreateGuide,
} = require("../../src/services/skill-create-guide");
const { skillCreatorSkill } = require("../../src/services/builtin-skills");

describe("skill-create-guide", function () {
  it("only names tools the add-in can actually run", function () {
    SKILL_TOOL_CATALOG.forEach(function (t) {
      assert.ok(HANDLED_TOOLS.has(t.name), t.name + " missing from HANDLED_TOOLS");
    });
  });

  it("tells creators to orchestrate Office JS instead of dumping the grid", function () {
    const g = skillCreateGuide();
    assert.ok(g.indexOf("extract_selection") >= 0);
    assert.ok(g.indexOf("reconcile_tables") >= 0);
    assert.ok(g.indexOf("write_inputs") >= 0);
    assert.ok(g.indexOf("write_to_sheet") >= 0);
    assert.ok(g.indexOf("禁止") >= 0);
    assert.ok(/倾倒表体|读进对话/.test(g));
  });

  it("is injected into /skill-creator so drafts follow it", function () {
    assert.ok(skillCreatorSkill.indexOf("编排 Office JS") >= 0);
    assert.ok(skillCreatorSkill.indexOf("extract_selection") >= 0);
    assert.ok(skillCreatorSkill.indexOf("发明工具名") >= 0);
  });
});
