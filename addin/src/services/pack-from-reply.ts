/** Parse /skill-creator Pack-mode fences into zip paths. */

const PACK_JSON = "pack.json";
const SKILL_RE = /^skills\/([^/]+)\/SKILL\.md$/i;
const KNOWLEDGE_RE = /^knowledge\/([^/]+\.md)$/i;

export function normalizePackZipPath(tag: string): string | null {
  const raw = String(tag || "")
    .trim()
    .split(/\s+/)[0]
    .replace(/\\/g, "/")
    .replace(/^\//, "");
  if (!raw) return null;
  if (raw === PACK_JSON) return PACK_JSON;
  if (SKILL_RE.test(raw)) return raw.replace(/SKILL\.md$/i, "SKILL.md");
  if (KNOWLEDGE_RE.test(raw)) return raw;
  return null;
}

export function extractPackFiles(text: string): Record<string, string> | null {
  const raw = String(text || "");
  if (!raw.trim()) return null;
  const out: Record<string, string> = {};
  const re = /```([^\n`]*)\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const path = normalizePackZipPath(m[1] || "");
    if (!path) continue;
    out[path] = String(m[2] || "").replace(/\s+$/, "") + "\n";
  }
  if (!out[PACK_JSON]) return null;
  return out;
}
