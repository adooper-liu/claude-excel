require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  snapshotMessages,
  titleFromMessages,
  hasChatContent,
  upsertSession,
  removeSession,
  parseSessionList,
  compactToolInput,
  hydrateMessages,
  maxMsgId,
  MAX_SESSIONS,
} = require("../../src/services/chat-sessions");

describe("chat-sessions", function () {
  it("titles from the first user ask and ignores empty chats", function () {
    assert.strictEqual(titleFromMessages([]), "新会话");
    assert.strictEqual(hasChatContent([{ role: "assistant", content: "hi" }]), false);
    assert.strictEqual(
      titleFromMessages([{ role: "user", content: "提取店铺列，并规范大小写与格式" }]),
      "提取店铺列，并规范大小写与格式"
    );
  });

  it("snapshots messages without tool payloads", function () {
    const stored = snapshotMessages([
      {
        id: "1",
        role: "user",
        content: "去重",
      },
      {
        id: "2",
        role: "tool",
        content: "",
        steps: [
          {
            name: "extract_selection",
            input: { column: "店铺", unique: true, data: "x".repeat(5000) },
            result: '{"rows":99999}',
            ms: 12,
          },
        ],
      },
    ]);
    assert.strictEqual(stored[1].steps[0].name, "extract_selection");
    assert.strictEqual(stored[1].steps[0].input.column, "店铺");
    assert.strictEqual(stored[1].steps[0].input.data, undefined);
    assert.strictEqual(stored[1].steps[0].result, undefined);
  });

  it("keeps only small tool input keys", function () {
    assert.deepStrictEqual(compactToolInput({ column: "店铺", foo: 1 }), { column: "店铺" });
  });

  it("upserts newest first and caps the list", function () {
    const many = [];
    for (let i = 0; i < MAX_SESSIONS + 5; i++) {
      many.push({ id: "s" + i, title: "t", updatedAt: i, messages: [] });
    }
    const next = upsertSession(many, { id: "new", title: "n", updatedAt: 999, messages: [] });
    assert.strictEqual(next[0].id, "new");
    assert.strictEqual(next.length, MAX_SESSIONS);
    assert.strictEqual(removeSession(next, "new").length, MAX_SESSIONS - 1);
  });

  it("parses stored JSON and ignores junk", function () {
    assert.deepStrictEqual(parseSessionList("not json"), []);
    assert.strictEqual(parseSessionList('[{"id":"a","title":"t","updatedAt":1,"messages":[]}]').length, 1);
  });

  it("hydrates steps with empty input so the UI does not crash", function () {
    const msgs = hydrateMessages([
      { id: "3", role: "tool", content: "", steps: [{ name: "extract_selection", ms: 9 }] },
    ]);
    assert.deepStrictEqual(msgs[0].steps[0].input, {});
    assert.strictEqual(maxMsgId(msgs), 3);
  });
});
