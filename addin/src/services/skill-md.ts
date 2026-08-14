/** Parse Claude-style SKILL.md (YAML frontmatter + body). Prompt-only; no new tools. */

export type ParsedSkill = {
  id: string;
  slash: string;
  title: string;
  body: string;
};

const RESERVED = new Set([
  "reconcile",
  "reshape",
  "calculate",
  "对账",
  "整形",
  "计算",
  "去重",
  "反透视",
  "求和",
  "匹配",
  "修公式",
  "skill",
  "skills",
  "安装",
  "install",
]);

export function reservedSkillId(value: string): boolean {
  return RESERVED.has(String(value || "").trim());
}

function unquote(v: string): string {
  const s = v.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseFrontmatter(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!m) continue;
    const val = unquote(m[2] || "");
    if (val) out[m[1]] = val;
  }
  return out;
}

function safeId(name: string): string {
  const s = String(name || "").trim();
  if (!s || s === "." || s === ".." || /[\\/:]/.test(s) || s.length > 64) {
    throw new Error("SKILL.md 的 name 无效");
  }
  return s;
}

export function extractSkillMarkdown(text: string): string | null {
  const raw = String(text || "").replace(/^\uFEFF/, "").trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:markdown|md|yaml)?\s*\r?\n([\s\S]*?)```/i);
  const candidate = (fence ? fence[1] : raw).trim();
  const inner = candidate.match(/---\r?\n[\s\S]*?\r?\n---\r?\n[\s\S]+/);
  if (!inner) return null;
  try {
    parseSkillMarkdown(inner[0]);
    return inner[0].trim();
  } catch {
    return null;
  }
}

export function parseSkillMarkdown(raw: string): ParsedSkill {
  const text = String(raw || "").replace(/^\uFEFF/, "");
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) {
    throw new Error("SKILL.md 需要 YAML frontmatter（name、description）");
  }
  const meta = parseFrontmatter(m[1]);
  const name = meta.name || "";
  const description = meta.description || "";
  if (!name || !description) {
    throw new Error("SKILL.md 需要 name 和 description");
  }
  const id = safeId(name);
  const slash = unquote(meta.slash || id).replace(/^\//, "").trim();
  if (!slash || /\s/.test(slash) || slash.length > 20) {
    throw new Error("slash 无效");
  }
  if (reservedSkillId(id) || reservedSkillId(slash)) {
    throw new Error("不能覆盖内置技能");
  }
  const body = String(m[2] || "").trim();
  if (!body) {
    throw new Error("SKILL.md 正文不能为空");
  }
  return { id, slash, title: description, body };
}
