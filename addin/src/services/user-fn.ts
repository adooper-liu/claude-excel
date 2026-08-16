import type { ToolCall } from "./claude";

const API = "https://localhost:8765/api/user-fn";

export type ConnectorFeedPayload = {
  feed: string;
  packId: string;
  sheetName: string;
  headers: string[];
  rows: (string | number)[][];
  meta?: Record<string, unknown>;
};

export async function loadConnectorFeed(
  feed: "orders" | "ads" | "inventory",
  packId = "cross-border-ecommerce-finance"
): Promise<ConnectorFeedPayload> {
  const r = await fetch(API + "/" + encodeURIComponent("user.connector_load_feed"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: { feed, packId } }),
  });
  const body = await r.text();
  let parsed: { ok?: boolean; data?: ConnectorFeedPayload; error?: { message?: string } };
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    throw new Error("connector 响应不是 JSON");
  }
  if (!parsed.ok || !parsed.data) {
    throw new Error(parsed.error?.message || "user.connector_load_feed 失败");
  }
  return parsed.data;
}

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
