import type { ToolCall } from "./claude";

const API = "https://localhost:8765/api/user-fn";

export async function executeUserFn(tool: ToolCall): Promise<string> {
  const name = String(tool.name || "").trim();
  if (!name.startsWith("user.")) {
    return JSON.stringify({ ok: false, error: { code: "INVALID_NAME", message: "not a user.* tool" } });
  }
  const r = await fetch(API + "/" + encodeURIComponent(name), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: tool.input || {} }),
  });
  const body = await r.text();
  if (!body) {
    return JSON.stringify({ ok: false, error: { code: "INVALID_JSON", message: "empty response" } });
  }
  return body;
}
