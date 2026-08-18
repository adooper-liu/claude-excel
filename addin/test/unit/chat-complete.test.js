require("ts-node/register/transpile-only");
const assert = require("assert");
const { chatWithTools } = require("../../src/services/claude");

// 构造 completeOnce 响应：content 是 Anthropic 风格块数组
function resp(...blocks) {
  return { content: blocks };
}
function text(t) {
  return { type: "text", text: t };
}
function tool(name, id, input) {
  return { type: "tool_use", id: id || "t_" + name, name: name, input: input || {} };
}

function run(queue) {
  let calls = 0;
  const impl = async function () {
    if (calls >= queue.length) return resp(text("(end)"));
    return queue[calls++];
  };
  const tokens = [];
  const cb = {
    history: [],
    onToken: (t) => tokens.push(t),
    onToolUse: () => "ok",
    onUsage: () => {},
  };
  return chatWithTools("system", "跑整表校验", [], cb, impl).then((result) => ({
    result: result,
    calls: calls,
    tokens: tokens.join(""),
  }));
}

describe("chatWithTools complete 契约（有尽头：不匹配措辞，只看有没有调 complete）", function () {
  it("工具后纯文字被自动续，最终调 complete 以结论结束", async function () {
    const { result, calls } = await run([
      resp(tool("read_range")),
      resp(text("已执行 1 步，尚未写出新表")),
      resp(tool("complete", "c1", { result: "校验完成，无倒挂" })),
    ]);
    assert.strictEqual(calls, 3, "纯文字应触发一次自动续");
    assert.strictEqual(result, "校验完成，无倒挂");
  });

  it("连续纯文字不调 complete，超过 MAX_CONTINUATION → fail-visible 警告", async function () {
    const { result } = await run([
      resp(tool("read_range")),
      resp(text("中途状态 1")),
      resp(text("中途状态 2")),
      resp(text("中途状态 3")),
    ]);
    assert.ok(
      result.indexOf("⚠️ 模型未能正常结束任务") >= 0,
      "应给出 fail-visible 警告，实际：" + result
    );
  });

  it("纯问答（未用工具）文字直接结束，不触发自动续", async function () {
    const { result, calls } = await run([resp(text("这是直接回答"))]);
    assert.strictEqual(result, "这是直接回答");
    assert.strictEqual(calls, 1);
  });
});
