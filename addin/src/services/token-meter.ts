export type TokenUsage = {
  tokens: number;
  byModel: Record<string, number>;
};

const RATE_PER_MILLION: Record<string, number> = {
  deepseek: 0.35,
  qwen: 1.2,
  glm: 1.0,
  minimax: 0.8,
};

function rateFor(model: string): number {
  const m = String(model || "").toLowerCase();
  for (const key of Object.keys(RATE_PER_MILLION)) {
    if (m.indexOf(key) >= 0) return RATE_PER_MILLION[key];
  }
  return 0.8;
}

export function addUsage(prev: TokenUsage | undefined, model: string, tokens: number): TokenUsage {
  const base: TokenUsage = prev || { tokens: 0, byModel: {} };
  const n = Math.max(0, Math.round(tokens));
  const byModel = { ...base.byModel };
  byModel[model] = (byModel[model] || 0) + n;
  return { tokens: base.tokens + n, byModel };
}

export function estimateCostUsd(tokens: number, model: string): number {
  return (tokens / 1_000_000) * rateFor(model);
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) return (tokens / 1000).toFixed(1) + "k";
  return String(tokens);
}

export function formatTokenBadge(usage: TokenUsage): string {
  let usd = 0;
  for (const m of Object.keys(usage.byModel)) {
    usd += estimateCostUsd(usage.byModel[m], m);
  }
  const money = usd < 0.01 ? "<$0.01" : "$" + usd.toFixed(2);
  return formatTokenCount(usage.tokens) + " · " + money;
}

export function usageTooltip(usage: TokenUsage): string {
  const lines = Object.keys(usage.byModel).map((m) => m + ": " + formatTokenCount(usage.byModel[m]));
  return lines.length ? "本 session\n" + lines.join("\n") : "本 session 尚未调用模型";
}
