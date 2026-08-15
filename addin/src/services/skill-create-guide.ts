/** How user SKILL.md must orchestrate existing Office JS tools. Prompt-only; no new executors. */

export type SkillToolHint = { name: string; use: string };

/** Subset of HANDLED_TOOLS that a user skill is allowed to name in steps. */
export const SKILL_TOOL_CATALOG: SkillToolHint[] = [
  { name: "inspect_workbook", use: "先看表名、表头、行数。不要倾倒表体。" },
  { name: "inspect_table", use: "看一张 Table 的表头和最多 5 行样例。" },
  { name: "inspect_formulas", use: "分清输入格与公式格，抽查错误。" },
  { name: "scan_formula_errors", use: "只扫 #REF! #DIV/0! 等错误值。" },
  { name: "ensure_table", use: "把带表头的区域升级成 Table，后续用返回的 name。" },
  { name: "extract_selection", use: "提取一列：去空格、大小写、可选去重。万行在 Excel 里做。" },
  { name: "reshape_table", use: "dedupe|unpivot|split|coerce|project，只写新表。" },
  { name: "reconcile_tables", use: "两表精确对账，只写新表。" },
  { name: "calculate_table", use: "lookup=INDEX/MATCH；sumifs=活汇总；fix_ref 修 #REF!。禁止写死合计。" },
  { name: "create_pivot", use: "透视表。字段名必须来自 inspect 的真实表头。" },
  { name: "write_inputs", use: "只改假设/输入格。公式格会拒绝。" },
  { name: "write_formula", use: "往少量格子写公式。整列填充改用 fill_range。" },
  { name: "fill_range", use: "像拖填充柄：公式向下/向右。不要把公式字符串读进对话。" },
  { name: "find_replace", use: "查找替换。lookIn=values 时不碰公式格。" },
  { name: "sort_filter", use: "排序或按条件筛选。column 用表头或列字母。" },
  { name: "format_range", use: "字色、底色、数字格式、边框、对齐、冻结。" },
  { name: "conditional_format", use: "数据条/色阶/图标/单元格值/前十。" },
  { name: "data_validation", use: "下拉列表或数字范围。" },
  { name: "create_chart", use: "柱/折/饼等。不要手写图的数据到格子里。" },
  { name: "web_fetch", use: "公开 https。密码不准进参数。" },
  { name: "write_to_sheet", use: "仅取数结果或用户明确要的小样例。禁止用来伪造对账/整形/透视。" },
  { name: "set_active_sheet", use: "切到结果表给用户看。" },
];

export const SKILL_ORCHESTRATION_GUIDE = [
  "## 编排 Office JS（强制）",
  "",
  "用户技能是步骤清单，只能调用上表算子。创建本回合只 inspect、不改表；写进 SKILL.md 的步骤才是以后运行时要调用的工具。",
  "",
  "### 每步怎么写",
  "",
  "祈使句：工具名 + 参数从哪来（inspect 的真实表头，不要猜「订单号」）。🟢 只能是目录里有的动作。目录没有的标 🟡/🔴，写「现有工具做不了」，不要假装。",
  "",
  "推荐骨架：inspect_workbook → 还不是 Table 则 ensure_table（用返回 name）→ extract_selection / reshape_table / reconcile_tables / calculate_table / create_pivot / write_inputs 等 → 中文报告新表名。冲突和口径给人判。",
  "",
  "### 禁止写进技能",
  "",
  "- 发明工具名，或写 Python / VBA / openpyxl。",
  "- 把整列/整表读进对话再 write_to_sheet 或 write_to_range。",
  "- 对账、整形、提取、透视的结果用手写格子伪造。",
  "- 用 write_to_range / write_formula 覆盖已有公式；改假设只用 write_inputs。",
  "- 编造关税、广告费率、行业基准；口径只列 2–3 个选项。",
  "- 为某一句中文发明专用步骤（例如只认「店铺列」）。列名做成参数。",
].join("\n");

export function formatSkillToolCatalog(): string {
  return SKILL_TOOL_CATALOG.map(function (t) {
    return "- `" + t.name + "` — " + t.use;
  }).join("\n");
}

export function skillCreateGuide(): string {
  return [
    "## 可用算子",
    "",
    formatSkillToolCatalog(),
    "",
    SKILL_ORCHESTRATION_GUIDE,
  ].join("\n");
}
