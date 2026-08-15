require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  parseAssistantContent,
  appendSummaryNudge,
  compactToolDigest,
  SUMMARY_NUDGE,
} = require("../../src/services/agent-finish");

describe("parseAssistantContent", function () {
  it("joins text blocks and lists tool_use", function () {
    const r = parseAssistantContent([
      { type: "text", text: "先看表" },
      { type: "tool_use", id: "1", name: "inspect_workbook", input: {} },
    ]);
    assert.strictEqual(r.text, "先看表");
    assert.strictEqual(r.toolUses.length, 1);
    assert.strictEqual(r.toolUses[0].name, "inspect_workbook");
  });

  it("treats missing or empty content as no text and no tools", function () {
    assert.deepStrictEqual(parseAssistantContent(undefined), { text: "", toolUses: [] });
    assert.deepStrictEqual(parseAssistantContent([]), { text: "", toolUses: [] });
  });

  it("does not treat DeepSeek web_search as a client tool the add-in must run", function () {
    const r = parseAssistantContent([
      { type: "server_tool_use", id: "s1", name: "web_search" },
      { type: "web_search_tool_result", content: [{ title: "Example", url: "https://ex.com" }] },
      { type: "tool_use", id: "2", name: "web_search", input: { query: "x" } },
      { type: "tool_use", id: "3", name: "web_fetch", input: { url: "https://ex.com" } },
    ]);
    assert.ok(r.text.indexOf("encrypted_content") < 0);
    assert.ok(r.text.indexOf("Example") >= 0 || r.text === "");
    assert.strictEqual(r.toolUses.length, 1);
    assert.strictEqual(r.toolUses[0].name, "web_fetch");
  });
});

describe("sanitizeAssistantText", function () {
  const { sanitizeAssistantText } = require("../../src/services/agent-finish");

  it("drops encrypted_content dumps and keeps title/url", function () {
    const raw =
      "已定位 ASIN。先搜索官方来源：" +
      JSON.stringify([
        {
          type: "web_search_result",
          title: "Echo Dot",
          url: "https://www.amazon.ca/dp/B09B8V1LZ3",
          encrypted_content: "AAAA" + "x".repeat(400),
        },
      ]);
    const out = sanitizeAssistantText(raw);
    assert.ok(out.indexOf("已定位") >= 0);
    assert.ok(out.indexOf("Echo Dot") >= 0);
    assert.ok(out.indexOf("amazon.ca") >= 0);
    assert.ok(out.indexOf("encrypted_content") < 0);
    assert.ok(out.indexOf("AAAAxxxx") < 0);
  });
});

describe("appendSummaryNudge", function () {
  it("appends a text block to the last user tool_result turn", function () {
    const messages = [
      { role: "user", content: "对账" },
      { role: "assistant", content: [{ type: "tool_use", id: "1", name: "inspect_workbook" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "1", content: "ok" }] },
    ];
    appendSummaryNudge(messages);
    const last = messages[messages.length - 1];
    assert.strictEqual(last.role, "user");
    assert.strictEqual(messages.filter((m) => m.role === "user").length, 2);
    const texts = last.content.filter((b) => b.type === "text").map((b) => b.text);
    assert.ok(texts.some((t) => t.indexOf("若已写出新表") >= 0));
  });
});

describe("compactToolDigest", function () {
  it("summarizes new sheets and failures instead of dumping JSON", function () {
    const lines = [
      'inspect_workbook → {"sheets":[{"name":"订单"}]}',
      'calculate_table → calculate_table failed: 参数无效或缺少，或格式不正确。',
      'calculate_table → {"outputSheet":"公式修复","op":"fix_ref","rows":0,"formulaCells":1}',
      'calculate_table → {"outputSheet":"汇总结果","op":"sumifs","rows":2}',
    ];
    const out = compactToolDigest(lines);
    assert.ok(out.indexOf("公式修复") >= 0);
    assert.ok(out.indexOf("汇总结果") >= 0);
    assert.ok(out.indexOf("失败") >= 0);
    assert.ok(out.indexOf("usedAddress") < 0);
    assert.ok(out.indexOf(SUMMARY_NUDGE) < 0);
  });
});
