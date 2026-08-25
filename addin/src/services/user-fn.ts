import type { ToolCall } from "./claude";
import { API_BASE } from "./api-config";

const API = API_BASE + "/api/user-fn";

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
  packId = "cross-border-ecommerce-finance",
  opts?: { content?: string; contentBase64?: string }
): Promise<ConnectorFeedPayload> {
  const params: Record<string, string> = { feed, packId };
  if (opts?.contentBase64) params.contentBase64 = opts.contentBase64;
  else if (opts?.content) params.content = opts.content;
  const r = await fetch(API + "/" + encodeURIComponent("user.connector_load_feed"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params }),
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
