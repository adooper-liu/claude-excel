require("ts-node/register/transpile-only");
const assert = require("assert");
const { BUILTIN_PROMPTS, mergeTemplates } = require("../../src/services/prompt-templates");

describe("prompt-templates", function () {
  it("has the four preset titles", function () {
    const titles = BUILTIN_PROMPTS.map((p) => p.title);
    assert.ok(titles.indexOf("生成样本数据") >= 0);
    assert.ok(titles.indexOf("月度报告") >= 0);
    assert.ok(titles.indexOf("透视分析") >= 0);
    assert.ok(titles.indexOf("清洗脏数据") >= 0);
  });

  it("puts custom templates after builtins and skips duplicate ids", function () {
    const merged = mergeTemplates(BUILTIN_PROMPTS, [
      { id: "sample", title: "覆盖", prompt: "nope" },
      { id: "mine", title: "我的模板", prompt: "hello" },
    ]);
    assert.strictEqual(merged.filter((p) => p.id === "sample").length, 1);
    assert.strictEqual(merged.filter((p) => p.id === "sample")[0].title, "生成样本数据");
    assert.ok(merged.some((p) => p.id === "mine" && p.prompt === "hello"));
  });
});
