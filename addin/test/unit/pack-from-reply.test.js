require("ts-node/register/transpile-only");
const assert = require("assert");
const { extractPackFiles, normalizePackZipPath } = require("../../src/services/pack-from-reply");

describe("pack-from-reply", function () {
  it("normalizePackZipPath accepts pack paths only", function () {
    assert.strictEqual(normalizePackZipPath("pack.json"), "pack.json");
    assert.strictEqual(normalizePackZipPath("skills/foo/SKILL.md"), "skills/foo/SKILL.md");
    assert.strictEqual(normalizePackZipPath("knowledge/note.md"), "knowledge/note.md");
    assert.strictEqual(normalizePackZipPath("json"), null);
    assert.strictEqual(normalizePackZipPath("skills/../x/SKILL.md"), null);
  });

  it("extractPackFiles reads path-tagged fences", function () {
    const text = [
      "如下：",
      "```pack.json",
      '{"id":"local-demo","skills":["demo"]}',
      "```",
      "```skills/demo/SKILL.md",
      "---",
      "name: demo",
      "description: d",
      "slash: demo",
      "---",
      "# body",
      "```",
      "```knowledge/tip.md",
      "tip",
      "```",
    ].join("\n");
    const files = extractPackFiles(text);
    assert.ok(files);
    assert.ok(files["pack.json"].indexOf("local-demo") >= 0);
    assert.ok(files["skills/demo/SKILL.md"].indexOf("name: demo") >= 0);
    assert.ok(files["knowledge/tip.md"].indexOf("tip") >= 0);
  });

  it("extractPackFiles returns null without pack.json", function () {
    assert.strictEqual(extractPackFiles("```skills/x/SKILL.md\n---\nname: x\n---\n#\n```"), null);
  });
});
