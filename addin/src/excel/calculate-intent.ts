import { isSetupRequest } from "./intent-guard";

export type CalculateOp = "lookup" | "sumifs" | "fix_ref";

export interface CalculateIntent {
  op: CalculateOp;
  key?: string;
  bringColumns?: string[];
  groupBy?: string;
  valueColumn?: string;
}

export function isCalculateRequest(text: string): boolean {
  const t = String(text || "").trim();
  if (isSetupRequest(t)) return false;
  if (/对账|reconcile|去重|反透视|拆列/i.test(t)) return false;
  return (
    /按.{1,20}求和/.test(t) ||
    /分类汇总|SUMIFS|XLOOKUP|VLOOKUP|匹配过来|查找填充|#REF/i.test(t) ||
    /修(复)?引用/.test(t)
  );
}

export function parseCalculateIntent(text: string): CalculateIntent {
  const t = String(text || "").trim();

  const sum = t.match(/按\s*([^，,]+?)\s*求和/);
  if (sum) return { op: "sumifs", groupBy: sum[1].trim() };
  if (/分类汇总|SUMIFS/i.test(t)) {
    const g = t.match(/按\s*([^，,]+)/);
    return { op: "sumifs", groupBy: g ? g[1].trim() : undefined };
  }

  if (/#REF|修(复)?引用/i.test(t)) return { op: "fix_ref" };

  const lookup = t.match(/按\s*([^，,]+?)\s*把\s*([^，,]+?)\s*匹配过来/);
  if (lookup) {
    return { op: "lookup", key: lookup[1].trim(), bringColumns: [lookup[2].trim()] };
  }
  const bring = t.match(/把\s*([^，,]+?)\s*匹配过来/);
  if (bring) return { op: "lookup", bringColumns: [bring[1].trim()] };
  if (/XLOOKUP|VLOOKUP|查找填充/i.test(t)) return { op: "lookup" };

  throw new Error("请说明用公式做什么，例如：按类别求和，或按订单号把金额匹配过来");
}

export function inferValueColumn(headers: string[], groupBy: string): string {
  const preferred = ["金额", "数量", "合计", "总额", "Amount", "Qty"];
  for (let i = 0; i < preferred.length; i++) {
    if (preferred[i] !== groupBy && headers.indexOf(preferred[i]) >= 0) return preferred[i];
  }
  const rest = headers.filter(function (h) {
    return h && h !== groupBy;
  });
  if (rest.length === 1) return rest[0];
  throw new Error("请说明对哪一列求和。现有列: " + headers.join("、"));
}

export function inferKey(headersLeft: string[], headersRight: string[], fromText?: string): string {
  if (fromText && headersLeft.indexOf(fromText) >= 0 && headersRight.indexOf(fromText) >= 0) {
    return fromText;
  }
  const shared = headersLeft.filter(function (h) {
    return h && headersRight.indexOf(h) >= 0;
  });
  const preferred = ["订单号", "单号", "ID", "id"];
  for (let i = 0; i < preferred.length; i++) {
    if (shared.indexOf(preferred[i]) >= 0) return preferred[i];
  }
  if (shared.length === 1) return shared[0];
  throw new Error(
    "请说明按哪一列查找，例如：按订单号把金额匹配过来。左表: " +
      headersLeft.join("、") +
      "；右表: " +
      headersRight.join("、")
  );
}
