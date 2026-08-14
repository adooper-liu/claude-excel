import { reservedSkillId } from "./skill-md";

export type SkillId = string;

export type SlashSkill = {
  id: SkillId;
  slash: string;
  title: string;
  body?: string;
  installed?: boolean;
};

export const SLASH_SKILLS: SlashSkill[] = [
  { id: "reconcile", slash: "对账", title: "两表精确对账，只写新表" },
  { id: "reshape", slash: "整形", title: "去重 / 反透视 / 拆列 / 转数字" },
  { id: "calculate", slash: "计算", title: "活公式：SUMIFS / INDEX+MATCH / 修 #REF!" },
  { id: "skillify", slash: "skill", title: "把流程做成可复用技能" },
];

const ALIAS: Record<string, { id: SkillId; extra: string }> = {
  reconcile: { id: "reconcile", extra: "" },
  对账: { id: "reconcile", extra: "" },
  reshape: { id: "reshape", extra: "" },
  整形: { id: "reshape", extra: "" },
  去重: { id: "reshape", extra: "去重" },
  反透视: { id: "reshape", extra: "反透视" },
  calculate: { id: "calculate", extra: "" },
  计算: { id: "calculate", extra: "" },
  求和: { id: "calculate", extra: "求和" },
  匹配: { id: "calculate", extra: "匹配过来" },
  修公式: { id: "calculate", extra: "修复 #REF!" },
  skill: { id: "skillify", extra: "" },
  skillify: { id: "skillify", extra: "" },
  创建技能: { id: "skillify", extra: "" },
};

const ASK: Record<string, string> = {
  reconcile:
    "对当前工作簿做对账。先 inspect_workbook，按实际表头选键，不要假设列名。结果只写新表。",
  reshape:
    "对当前工作簿做整形。先 inspect，按实际表头选择去重、反透视、拆列或转数字，不要假设列名。结果只写新表。",
  calculate:
    "对当前工作簿写活公式。先 inspect，按实际表头选择 lookup、sumifs 或 fix_ref，不要假设列名。禁止把汇总值写死。",
  skillify:
    "把用户的工作流做成一条可安装的 Excel 技能。若 /对账 /整形 /计算 或已有斜杠已经覆盖，说明该用哪个，不要新建。用户没说清楚要自动化什么时先问一两句。否则可 inspect_workbook（只读，不要改表），起草标准 SKILL.md：YAML 必须有 name、description，建议 slash（中文短命令，不能是 skill/对账/整形/计算）。正文写步骤，只用现有工具，按实际表头工作，结果只写新表。最后用一个 markdown 代码块给出完整 SKILL.md。",
};

export function mergeSlashSkills(installed?: SlashSkill[]): SlashSkill[] {
  const seen = new Set(SLASH_SKILLS.map((s) => s.slash));
  const extra: SlashSkill[] = [];
  for (const s of installed || []) {
    const id = String(s.id || "").trim();
    const slash = String(s.slash || "").trim();
    const title = String(s.title || "").trim();
    if (!id || !slash || !title) continue;
    if (reservedSkillId(id) || reservedSkillId(slash) || seen.has(slash)) continue;
    seen.add(slash);
    extra.push({
      id,
      slash,
      title,
      body: s.body,
      installed: true,
    });
  }
  return SLASH_SKILLS.concat(extra);
}

export function slashQuery(text: string): string | null {
  const t = String(text || "");
  if (!t.startsWith("/")) return null;
  const rest = t.slice(1);
  if (/\s/.test(rest)) return null;
  return rest;
}

export function filterSlashSkills(query: string, installed?: SlashSkill[]): SlashSkill[] {
  const catalog = mergeSlashSkills(installed);
  const q = String(query || "").trim().toLowerCase();
  if (!q || q === "skills") return catalog.slice();
  if (q === "安装" || q === "install") return [];
  return catalog.filter(function (s) {
    return (
      s.slash.toLowerCase().indexOf(q) >= 0 ||
      s.title.toLowerCase().indexOf(q) >= 0 ||
      s.id.toLowerCase().indexOf(q) >= 0
    );
  });
}

export function parseSlashCommand(
  text: string,
  installed?: SlashSkill[]
): { id: SkillId; extra: string } | null {
  const t = String(text || "").trim();
  const m = t.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const token = m[1];
  if (token === "skills" || token === "安装" || token === "install") {
    return null;
  }
  const extra = (m[2] || "").trim();
  const hit = mergeSlashSkills(installed).find(function (s) {
    return s.slash === token || s.id === token;
  });
  if (hit) return { id: hit.id, extra: extra };
  const alias = ALIAS[token];
  if (!alias) return null;
  return { id: alias.id, extra: extra || alias.extra };
}

/** How a sent slash command should appear in the chat (token as typed, title for tooltip). */
export function slashDisplay(
  text: string,
  installed?: SlashSkill[]
): { token: string; extra: string; title: string } | null {
  const parsed = parseSlashCommand(text, installed);
  if (!parsed) return null;
  const t = String(text || "").trim();
  const m = t.match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
  if (!m) return null;
  const skill = mergeSlashSkills(installed).find((s) => s.id === parsed.id);
  return { token: m[1], extra: (m[2] || "").trim(), title: skill ? skill.title : "" };
}

export function skillAsk(id: SkillId, extra?: string): string {
  const base =
    ASK[id] ||
    "按已安装技能处理当前工作簿。先 inspect_workbook，按实际表头工作，不要假设列名。结果只写新表。";
  const more = String(extra || "").trim();
  return more ? base + " 用户补充：" + more : base;
}
