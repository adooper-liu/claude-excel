import { isSetupRequest } from "./intent-guard";
import type { CaseMode } from "./extract-core";

export interface ExtractIntent {
  caseMode: CaseMode;
  unique: boolean;
  column?: string;
}

const GENERIC_COL = /^(选中|这一|当前|所选|此)$/;

export function isExtractRequest(text: string): boolean {
  const t = String(text || "").trim();
  if (isSetupRequest(t)) return false;
  if (/对账|reconcile|反透视|拆列|\/规范/i.test(t)) return false;
  if (/按.{1,20}去重/.test(t) && !/提取/.test(t)) return false;
  return (
    /提取选中|提取这一列|提取当前列|提取所选|把选中列|提取此列|提取.{0,12}列/.test(t) ||
    /大小写统一|统一大小写|规范大小写|大小写与格式|改成大写|改成小写|转成大写|转成小写|全部大写|全部小写/.test(t)
  );
}

export function parseColumnName(text: string): string | undefined {
  const t = String(text || "").trim();
  const m = t.match(/提取\s*([^，,。\s]{1,12}?)\s*列/);
  if (!m) return undefined;
  const name = m[1].trim();
  if (!name || GENERIC_COL.test(name)) return undefined;
  return name;
}

export function parseExtractIntent(text: string): ExtractIntent {
  const t = String(text || "").trim();
  let caseMode: CaseMode = "title";
  if (/小写|lower/i.test(t) && !/大小写/.test(t)) caseMode = "lower";
  else if (/大写|upper/i.test(t) && !/大小写/.test(t)) caseMode = "upper";
  else if (/保持原样|不改大小写/.test(t)) caseMode = "keep";
  else if (/标题|首字母/.test(t)) caseMode = "title";
  else if (/小写/.test(t) && /大写/.test(t)) caseMode = "title";
  const column = parseColumnName(t);
  return {
    caseMode: caseMode,
    unique: /去重|\bunique\b|\bdedupe\b/i.test(t),
    column: column,
  };
}
