/** Operator catalog derived from core manifests + Chinese hints. SSOT for /skill-creator UI. */

import { CORE_SKILL_MANIFESTS, type CoreSkillManifest } from "./skill-manifests";

export type OperatorEntry = {
  name: string;
  groupId: string;
  group: string;
  hint: string;
  description: string;
  userSkill: boolean;
};

export type OperatorGroup = {
  id: string;
  label: string;
  items: OperatorEntry[];
};

const MODULE_LABELS: Record<string, string> = {
  inspect: "读结构",
  table: "表",
  "read-write": "读写",
  reshape: "洗表",
  reconcile: "对账",
  calculate: "计算",
  pivot: "透视",
  formula: "公式",
  "sort-filter": "筛选排序",
  format: "格式",
  chart: "图表",
  navigation: "导航",
  web: "取数",
  knowledge: "知识库",
  flows: "流程",
  structure: "结构笔记",
  "pack-audit": "Pack 审计",
};

/** One-line Chinese hints; manifest description is fallback. */
const OPERATOR_HINTS: Record<string, string> = {
  inspect_workbook: "先看表名、表头、行数。不要倾倒表体。",
  inspect_table: "看一张 Table 的表头和最多 5 行样例；含 columnHints 列格式推断。",
  inspect_formulas: "分清输入格与公式格，抽查错误。",
  scan_formula_errors: "只扫 #REF! #DIV/0! 等错误值。",
  ensure_table: "把带表头的区域升级成 Table，后续用返回的 name。",
  read_selection: "读当前选区（小范围）。大表禁止经模型写回。",
  read_range: "读指定范围（小范围）。大表禁止经模型写回。",
  extract_selection: "提取一列：去空格、大小写、可选去重。万行在 Excel 里做。",
  write_to_sheet: "仅取数结果或用户明确要的小样例。禁止伪造对账/整形/透视。",
  write_to_range: "写指定范围。对账/整形/透视结果禁止手写格子。",
  write_inputs: "只改假设/输入格。公式格会拒绝。",
  get_sheet_names: "列出工作表名。",
  find_replace: "查找替换。lookIn=values 时不碰公式格。",
  reshape_table: "dedupe|unpivot|split|coerce|coerce_columns|project|flatten_header|flatten_reconcile，只写新表。",
  reconcile_tables: "两表精确对账，只写新表。",
  calculate_table: "lookup；sumifs/sumifs_multi（可多列分组+criteria）；arithmetic；conditional_column；fix_ref。禁止写死合计。",
  create_pivot: "透视表。字段名必须来自 inspect 的真实表头。",
  write_formula: "往少量格子写公式。整列填充改用 fill_range。",
  fill_range: "像拖填充柄：公式向下/向右。不要把公式字符串读进对话。",
  sort_filter: "排序或按条件筛选。column 用表头或列字母。",
  format_range: "字色、底色、数字格式、边框、对齐、冻结。",
  conditional_format: "数据条/色阶/图标/单元格值/前十。",
  data_validation: "下拉列表或数字范围。",
  create_chart: "柱/折/饼等。不要手写图的数据到格子里。",
  set_active_sheet: "切到结果表给用户看。",
  web_fetch: "公开 https。密码不准进参数。",
  search_knowledge: "检索本机 ~/.claude-excel-web/knowledge/ 已上传文档。",
  append_pack_audit: "向 _pack_audit 追加一行：Pack 运行留痕（匹配计数/假设快照/匹配率）。",
};

/** Not recommended in user SKILL.md steps (low-level / easy to dump grid). */
const USER_SKILL_EXCLUDE = new Set([
  "read_selection",
  "read_range",
  "write_to_range",
  "get_sheet_names",
  "run_flow",
  "complete",
  "save_structure_note",
  "load_structure_notes",
]);

function shortDescription(text: string): string {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > 72 ? s.slice(0, 69) + "…" : s;
}

function entriesFromManifest(m: CoreSkillManifest): OperatorEntry[] {
  const groupId = m.name;
  const group = MODULE_LABELS[groupId] || groupId;
  return (m.tools || []).map(function (t) {
    const name = String(t.name || "").trim();
    const description = String(t.description || "").trim();
    return {
      name,
      groupId,
      group,
      hint: OPERATOR_HINTS[name] || shortDescription(description) || name,
      description,
      userSkill: !USER_SKILL_EXCLUDE.has(name),
    };
  });
}

let cachedAll: OperatorEntry[] | null = null;

export function buildOperatorCatalog(): OperatorEntry[] {
  if (cachedAll) return cachedAll;
  const out: OperatorEntry[] = [];
  for (const m of CORE_SKILL_MANIFESTS) {
    out.push(...entriesFromManifest(m));
  }
  out.sort(function (a, b) {
    if (a.groupId !== b.groupId) return a.groupId.localeCompare(b.groupId);
    return a.name.localeCompare(b.name);
  });
  cachedAll = out;
  return out;
}

export function userSkillOperatorCatalog(): OperatorEntry[] {
  return buildOperatorCatalog().filter(function (e) {
    return e.userSkill;
  });
}

export function operatorCatalogByGroup(all?: boolean): OperatorGroup[] {
  const list = all ? buildOperatorCatalog() : userSkillOperatorCatalog();
  const map = new Map<string, OperatorGroup>();
  for (const e of list) {
    let g = map.get(e.groupId);
    if (!g) {
      g = { id: e.groupId, label: e.group, items: [] };
      map.set(e.groupId, g);
    }
    g.items.push(e);
  }
  return Array.from(map.values());
}

export function manifestToolNames(): string[] {
  return buildOperatorCatalog().map(function (e) {
    return e.name;
  });
}

export function formatOperatorList(entries: OperatorEntry[]): string {
  return entries
    .map(function (e) {
      return "- `" + e.name + "` — " + e.hint;
    })
    .join("\n");
}

export function formatOperatorCatalogForSkillCreator(): string {
  return formatOperatorList(userSkillOperatorCatalog());
}
