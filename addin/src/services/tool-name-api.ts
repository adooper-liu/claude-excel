import type { ToolDef } from "./claude";

/** DeepSeek / Anthropic-compatible APIs allow only [a-zA-Z0-9_-]+ tool names. */
export function toApiToolName(name: string): string {
  const n = String(name || "").trim();
  if (n.startsWith("user.")) {
    return n.replace(/\./g, "_");
  }
  return n;
}

/** Restore user.* names from API-safe aliases (user_foo_bar → user.foo_bar). */
export function fromApiToolName(apiName: string): string {
  const n = String(apiName || "").trim();
  if (n.startsWith("user_") && !n.startsWith("user.")) {
    return "user." + n.slice("user_".length);
  }
  return n;
}

export function mapToolsForApi(tools: ToolDef[]): ToolDef[] {
  return tools.map((t) => ({
    ...t,
    name: toApiToolName(t.name),
  }));
}
