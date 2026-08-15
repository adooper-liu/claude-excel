export const SUMMARY_NUDGE =
  "用中文写两三句：若已写出新表就报表名；若还没写完就说还缺哪一步。不要贴表格、JSON 或工具原文。";

export interface ParsedToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

function unescapeJsonString(s: string): string {
  try {
    return JSON.parse('"' + s.replace(/"/g, '\\"') + '"');
  } catch {
    return s;
  }
}

function collectSearchHits(raw: string): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  const re = /"title"\s*:\s*"((?:\\.|[^"\\])*)"[\s\S]{0,1500}?"url"\s*:\s*"((?:\\.|[^"\\])*)"/g;
  let m: RegExpExecArray | null = re.exec(raw);
  while (m && hits.length < 8) {
    const title = unescapeJsonString(m[1]);
    const url = unescapeJsonString(m[2]);
    if (url && !seen.has(url)) {
      seen.add(url);
      hits.push("- " + title + "  " + url);
    }
    m = re.exec(raw);
  }
  return hits;
}

/** Strip DeepSeek web_search payloads so the task pane never shows encrypted_content. */
export function sanitizeAssistantText(text: string): string {
  const raw = String(text || "");
  if (raw.indexOf("encrypted_content") < 0 && raw.indexOf("web_search_result") < 0) {
    return raw;
  }
  const hits = collectSearchHits(raw);
  const cut = raw.search(/\[\s*\{\s*"type"\s*:\s*"web_search_result"/);
  let prose = (cut >= 0 ? raw.slice(0, cut) : raw)
    .replace(/"encrypted_content"\s*:\s*"(?:\\.|[^"\\])*"/g, "")
    .replace(/\s+$/g, "")
    .trim();
  prose = prose.replace(/(先搜索官方来源|回退用 web_search[^\n：:]*)[:：]?\s*$/g, "").trim();
  const sources = hits.length ? "来源：\n" + hits.join("\n") : "";
  return [prose, sources].filter(Boolean).join("\n\n");
}

export function parseAssistantContent(content: unknown): {
  text: string;
  toolUses: ParsedToolUse[];
} {
  if (typeof content === "string") return { text: sanitizeAssistantText(content), toolUses: [] };
  if (!Array.isArray(content)) return { text: "", toolUses: [] };
  const texts: string[] = [];
  const searchBits: string[] = [];
  const toolUses: ParsedToolUse[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const block = b as { type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; content?: unknown };
    if (block.type === "text" && block.text) texts.push(block.text);
    if (block.type === "web_search_tool_result" && block.content != null) {
      searchBits.push(...collectSearchHits(JSON.stringify(block.content)));
    }
    if (block.type === "tool_use" && block.name && block.id && block.name !== "web_search") {
      toolUses.push({ id: block.id, name: block.name, input: block.input || {} });
    }
  }
  const joined = texts.join("");
  const fallback = !joined && searchBits.length ? "来源：\n" + searchBits.join("\n") : joined;
  return { text: sanitizeAssistantText(fallback), toolUses };
}

type ChatMessage = { role: string; content: unknown };

export function appendSummaryNudge(messages: ChatMessage[]): void {
  const last = messages[messages.length - 1];
  if (last && last.role === "user" && Array.isArray(last.content)) {
    last.content = [...last.content, { type: "text", text: SUMMARY_NUDGE }];
    return;
  }
  if (last && last.role === "user" && typeof last.content === "string") {
    last.content = last.content + "\n\n" + SUMMARY_NUDGE;
    return;
  }
  messages.push({ role: "user", content: SUMMARY_NUDGE });
}

export function compactToolDigest(lines: string[]): string {
  const sheets: string[] = [];
  const seen = new Set<string>();
  let failed = 0;
  for (const line of lines) {
    if (/failed|Error:/i.test(line)) failed += 1;
    const m = line.match(/"outputSheet"\s*:\s*"([^"]+)"/);
    if (m && !seen.has(m[1])) {
      seen.add(m[1]);
      sheets.push(m[1]);
    }
  }
  const parts = [`已完成 ${lines.length} 步。`];
  if (sheets.length) parts.push("新建表：" + sheets.join("、") + "。");
  if (failed) parts.push(`失败 ${failed} 次。`);
  return parts.join("");
}
