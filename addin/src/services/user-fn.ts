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

export type ProfitAssumptions = {
  referral_rate: number;
  fba_fee_rate: number;
  return_rate: number;
  ad_rate: number;
  cogs_rate: number;
  inbound_rate: number;
  storage_rate: number;
  fx_loss_rate: number;
  vat_rate: number;
  duty_rate: number;
  other_rate: number;
};

export type ProfitAssumptionsPayload = {
  assumptions: Array<{ asin: string } & ProfitAssumptions>;
  count: number;
  source: string;
};

export async function loadProfitAssumptions(asins: string[]): Promise<ProfitAssumptionsPayload> {
  const r = await fetch(API + "/" + encodeURIComponent("user.profit_assumptions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ params: { asins } }),
  });
  const body = await r.text();
  let parsed: { ok?: boolean; data?: ProfitAssumptionsPayload; error?: { message?: string } };
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    throw new Error("profit_assumptions 响应不是 JSON");
  }
  if (!parsed.ok || !parsed.data) {
    throw new Error(parsed.error?.message || "user.profit_assumptions 失败");
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
