/** How user SKILL.md must orchestrate existing Office JS tools. Prompt-only; no new executors. */

import {
  formatOperatorCatalogForSkillCreator,
  userSkillOperatorCatalog,
  type OperatorEntry,
} from "./operator-catalog";

export type SkillToolHint = { name: string; use: string };

/** Derived from manifests; refreshed each read (manifests are static at build). */
export function getSkillToolCatalog(): SkillToolHint[] {
  return userSkillOperatorCatalog().map(function (e: OperatorEntry) {
    return { name: e.name, use: e.hint };
  });
}

/** @deprecated Use getSkillToolCatalog(); kept for tests importing the array. */
export const SKILL_TOOL_CATALOG: SkillToolHint[] = getSkillToolCatalog();

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
  return formatOperatorCatalogForSkillCreator();
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
