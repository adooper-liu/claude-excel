import type { ToolDef } from "./claude";
import { isSetupRequest } from "../excel/intent-guard";

const NATIVE_HINT = /对账|reconcile|比对|核对|对上|去重|反透视|拆列|转成数字|转数字|reshape|unpivot|dedupe|求和|匹配过来|XLOOKUP|SUMIFS|#REF|查找填充/;
const NATIVE_BLOCKED = new Set(["write_to_sheet", "write_to_range", "write_formula", "web_fetch"]);

/** For 对账/整形/活公式, drop sheet-writing primitives so the model must call native tools. */
export function selectToolsForRequest(
  userText: string,
  tools: ToolDef[],
  skillId?: string
): ToolDef[] {
  if (isSetupRequest(userText)) return tools;
  if (skillId === "skillify") {
    return tools.filter((t) => t.name === "inspect_workbook" || t.name === "inspect_table");
  }
  const nativeSkill = skillId === "reconcile" || skillId === "reshape" || skillId === "calculate";
  if (!nativeSkill && !NATIVE_HINT.test(userText)) return tools;
  return tools.filter((t) => !NATIVE_BLOCKED.has(t.name));
}
