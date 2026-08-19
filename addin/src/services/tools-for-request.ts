import type { ToolDef } from "./claude";
import { isSetupRequest } from "../excel/intent-guard";

const NATIVE_HINT = /对账|reconcile|比对|核对|对上|去重|反透视|拆列|转成数字|转数字|reshape|unpivot|dedupe|求和|匹配过来|XLOOKUP|SUMIFS|#REF|查找填充|透视|pivot|提取选中|提取.{0,12}列|大小写统一|统一大小写|规范大小写|extract_selection|规整|整理.{0,8}列|映射|投影|整形|拍平|双层表头|合并表头|flatten_header|取数_/;
const CALCULATOR_HINT = /计算器|费用测算|运费计算|生成计算|测算表|算.{0,6}费用/;
const NATIVE_BLOCKED = new Set(["write_to_sheet", "write_to_range", "write_formula", "write_inputs", "web_fetch", "fill_range", "find_replace"]);

/** For 对账/整形/活公式/透视, drop sheet-writing primitives so the model must call native tools. */
export function selectToolsForRequest(
  userText: string,
  tools: ToolDef[],
  skillId?: string
): ToolDef[] {
  if (isSetupRequest(userText)) return tools;
  if (skillId === "skill-creator" || skillId === "deconstruct") {
    const allow = new Set(["inspect_workbook", "inspect_table", "inspect_formulas", "scan_formula_errors"]);
    return tools.filter((t) => allow.has(t.name));
  }
  if (skillId === "assume") {
    const allow = new Set([
      "inspect_workbook",
      "inspect_table",
      "inspect_formulas",
      "scan_formula_errors",
      "write_inputs",
      "format_range",
      "data_validation",
      "get_sheet_names",
    ]);
    return tools.filter((t) => allow.has(t.name));
  }
  if (skillId === "fetch") {
    const allow = new Set(["inspect_workbook", "inspect_table", "web_fetch", "write_to_sheet", "get_sheet_names"]);
    return tools.filter((t) => allow.has(t.name));
  }
  if (skillId === "research") {
    const allow = new Set([
      "inspect_workbook",
      "inspect_table",
      "inspect_formulas",
      "scan_formula_errors",
      "web_fetch",
      "search_knowledge",
      "write_to_sheet",
      "get_sheet_names",
    ]);
    return tools.filter((t) => allow.has(t.name));
  }
  if (skillId === "knowledge") {
    const allow = new Set([
      "inspect_workbook",
      "inspect_table",
      "inspect_formulas",
      "scan_formula_errors",
      "search_knowledge",
      "web_fetch",
      "write_to_sheet",
      "get_sheet_names",
    ]);
    return tools.filter((t) => allow.has(t.name));
  }
  if (skillId === "calculator" || CALCULATOR_HINT.test(userText)) {
    const allow = new Set([
      "inspect_workbook",
      "inspect_table",
      "inspect_formulas",
      "load_structure_notes",
      "save_structure_note",
      "get_sheet_names",
      "read_range",
      "read_selection",
      "ensure_table",
      "write_to_sheet",
      "write_to_range",
      "write_formula",
      "fill_range",
      "format_range",
      "data_validation",
      "write_inputs",
      "complete",
    ]);
    return tools.filter((t) => allow.has(t.name));
  }
  const nativeSkill =
    skillId === "reconcile" || skillId === "reshape" || skillId === "calculate" || skillId === "pivot";
  if (!nativeSkill && !NATIVE_HINT.test(userText)) return tools;
  return tools.filter((t) => !NATIVE_BLOCKED.has(t.name));
}
