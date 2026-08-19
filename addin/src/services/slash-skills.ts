import { reservedSkillId } from "./skill-md";

export type SkillId = string;

export type SlashSkill = {
  id: SkillId;
  slash: string;
  title: string;
  body?: string;
  installed?: boolean;
};

export const TALK_EXAMPLES = [
  "提取选中列，去空格并去重",
  "把两张表按键对账，结果写新表",
  "根据费率表生成计算器，新建 sheet",
  "只改假设数字，不要覆盖公式",
];

export const SLASH_SKILLS: SlashSkill[] = [
  { id: "reconcile", slash: "对账", title: "两表精确对账，只写新表" },
  { id: "reshape", slash: "整形", title: "洗表：去重 / 拆列 / 宽表转长表 / 转数字" },
  { id: "calculate", slash: "计算", title: "按条件求和 / 匹配数据 / 修 #REF!，公式活的" },
  { id: "calculator", slash: "计算器", title: "根据费率/参数表新建 sheet，输入即算（活公式）" },
  { id: "pivot", slash: "透视", title: "按表头做透视表" },
  { id: "assume", slash: "假设", title: "改参数或假设数字，公式自动重算，不覆盖公式" },
  { id: "fetch", slash: "取数", title: "从网址取表；登录用本机取数栏" },
  { id: "research", slash: "调研", title: "查资料、多源核实；默认不落表" },
  { id: "knowledge", slash: "知识", title: "检索本机已上传文档" },
  { id: "craft", slash: "规范", title: "查公式错误、标出能改的数字格、数字格式" },
  { id: "deconstruct", slash: "拆解", title: "把你的流程拆成步骤，标出哪些能自动做" },
  { id: "skill-creator", slash: "skill-creator", title: "把流程做成可复用技能" },
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
  calculator: { id: "calculator", extra: "" },
  计算器: { id: "calculator", extra: "" },
  费用测算: { id: "calculator", extra: "" },
  运费计算: { id: "calculator", extra: "" },
  求和: { id: "calculate", extra: "求和" },
  匹配: { id: "calculate", extra: "匹配过来" },
  修公式: { id: "calculate", extra: "修复 #REF!" },
  pivot: { id: "pivot", extra: "" },
  透视: { id: "pivot", extra: "" },
  assume: { id: "assume", extra: "" },
  假设: { id: "assume", extra: "" },
  情景: { id: "assume", extra: "" },
  fetch: { id: "fetch", extra: "" },
  取数: { id: "fetch", extra: "" },
  research: { id: "research", extra: "" },
  调研: { id: "research", extra: "" },
  查资料: { id: "research", extra: "" },
  knowledge: { id: "knowledge", extra: "" },
  知识: { id: "knowledge", extra: "" },
  知识库: { id: "knowledge", extra: "" },
  craft: { id: "craft", extra: "" },
  规范: { id: "craft", extra: "" },
  体检: { id: "craft", extra: "检查公式错误" },
  deconstruct: { id: "deconstruct", extra: "" },
  拆解: { id: "deconstruct", extra: "" },
  工作流: { id: "deconstruct", extra: "" },
  "skill-creator": { id: "skill-creator", extra: "" },
  skill: { id: "skill-creator", extra: "" },
  skillify: { id: "skill-creator", extra: "" },
  创建技能: { id: "skill-creator", extra: "" },
};

const ASK: Record<string, string> = {
  reconcile:
    "对当前工作簿做对账。先 inspect_workbook，按实际表头选键，不要假设列名。结果只写新表。",
  reshape:
    "对当前工作簿做整形。先 inspect，按实际表头选择去重、反透视、拆列或转数字，不要假设列名。结果只写新表。",
  calculate:
    "对当前工作簿写活公式。先 inspect，按实际表头选择 lookup、sumifs 或 fix_ref，不要假设列名。禁止把汇总值写死。要透视表时用 create_pivot。",
  calculator:
    "在当前工作簿**新建一张计算器 sheet**（write_to_sheet），按费率/参数长表写输入区与活公式（write_formula），源表只读。按「解读→建模→适配→验证」走：先读懂定价逻辑（键列、附加费触发/概率、权重/下限、燃油、单调性），再定输入与中间量，然后写活公式，最后扫错/抽验并 complete。用户补充说明（如快递费、FBA、关税）只影响输入项与公式口径，不改变「解读先行 + 新建 sheet + 活公式」流程。",
  pivot:
    "对当前工作簿做透视表。先 inspect_workbook，按实际表头选行字段和值字段，不要猜列名。用 create_pivot，不要手写汇总表。",
  assume:
    "就地改假设。先 inspect_formulas 认出输入格，只用 write_inputs 写入用户给的数字。公式格不要改。改完再看下游值和错误。",
  fetch:
    "从网址取结构化表写入新表。用户给了公开 URL 就 web_fetch 再 write_to_sheet。登录或三方反爬站不要问密码，让用户用取数栏：本机 Chrome/Edge 跟手操作，在网页窗口点选同类或框选后写入，不必每次回到 Excel。不要编造数字。若用户其实在问政策/竞品/口径，说明应走 /调研。",
  research:
    "开放信息调研：摘要、引用、口径选项。默认不改表。用 web_search 或公开 URL 的 web_fetch 只读正文，多源核对并标来源。登录站标 🔴 让用户自取数栏或自行查。不要和 /取数 混成一步。用户明确要求整理成表时才 write_to_sheet 小摘要。",
  knowledge:
    "检索本机知识库（任务窗格「知」栏上传的 .md/.txt/.csv）。用 search_knowledge，引用 docName 与片段；无命中不要编。可与 web_search 对照但内部文档优先说明来源。默认不改表。",
  craft:
    "规范当前工作簿。先 inspect_workbook，再用 inspect_formulas 或 scan_formula_errors 同时看公式和值。着色和数字格式用 format_range（输入蓝字 #0000FF、同表公式黑字、跨表绿字 #008000、关键假设黄底 #FFFF00）。汇总值必须是活公式。不要覆盖源表数值，不要假设列名。",
  deconstruct:
    "拆解用户说的工作流。先确认一句话命名，再写动作流、判断点、边界、验证。标 🟢🟡🔴。口径只列选项，不替用户拍板，不编数字。可 inspect 看表头。不要改表。末尾说明哪些 🟢 步骤可以做成技能。",
  "skill-creator":
    "把用户的工作流做成一条可安装的 Excel 技能。若对话上一轮有【拆解交接】代码块，直接按它起草——🟢 步骤映射现有算子、🟡 判断点作口径选项、验证锚点作试跑检查，不要重新问流程，只补口令/结果形态/试跑口令。若流程还含糊，先拆解再写技能。若现有对账、整形、计算、透视、假设、取数、调研、规范已经能做，用中文说明怎么开口即可，不要让用户先背斜杠清单，也不要新建技能。先判断用户处在哪一步（从零写 / 已有草稿要改 / 只要试跑）。用户没说清楚要自动化什么时，最多问四件事：做什么、什么口令触发、结果长什么样、要不要用当前表头走一遍。可 inspect_workbook（只读，不要改表）。起草 SKILL.md：YAML 必须有 name、description、slash。正文每步点名现有 Office JS 算子（extract_selection / reshape_table / reconcile_tables / calculate_table / create_pivot / write_inputs 等），禁止发明工具、禁止把表体读进对话再写回。附 2–3 句试跑口令。最后用一个 markdown 代码块给出完整 SKILL.md。",
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
  if (!q) return catalog.slice();
  if (q === "skills") return catalog.slice();
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
    "按已安装技能处理当前工作簿。先 inspect_workbook，按实际表头工作，不要假设列名。";
  const more = String(extra || "").trim();
  return more ? base + " 用户补充：" + more : base;
}
