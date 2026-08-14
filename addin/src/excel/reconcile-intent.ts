import { isSetupRequest } from "./intent-guard";

export interface SourceSheet {
  name: string;
  range: string | null;
  rows: number;
  headers: string[];
  tableNames: string[];
}

export function isReconcileRequest(text: string): boolean {
  const t = String(text || "").trim();
  if (isSetupRequest(t)) return false;
  return /按.{1,20}对账/.test(t) || /帮我对账|做对账|对一下账|\breconcile\b/i.test(t);
}

export function parseKeyFromText(text: string): string | null {
  const m = String(text || "").match(/按\s*([^，,]+?)\s*(?:对账|比对|核对|匹配)/);
  if (!m) return null;
  return m[1].trim() || null;
}

export function pickSourceSheets(sheets: SourceSheet[], key?: string | null): SourceSheet[] {
  const candidates = sheets.filter(function (s) {
    return s.rows > 1 && s.headers.length > 0 && !/对账|reconcile/i.test(s.name);
  });
  if (key) {
    const withKey = candidates.filter(function (s) {
      return s.headers.indexOf(key) >= 0;
    });
    if (withKey.length >= 2) return withKey.slice(0, 2);
  }
  return candidates.slice(0, 2);
}

export function inferKeys(userText: string, leftHeaders: string[], rightHeaders: string[]): string[] {
  const fromText = parseKeyFromText(userText);
  if (fromText) {
    if (leftHeaders.indexOf(fromText) >= 0 && rightHeaders.indexOf(fromText) >= 0) {
      return [fromText];
    }
    throw new Error(
      "两表都没有列「" + fromText + "」。左表: " + leftHeaders.join("、") + "；右表: " + rightHeaders.join("、")
    );
  }
  const shared = leftHeaders.filter(function (h) {
    return h && rightHeaders.indexOf(h) >= 0;
  });
  const preferred = ["订单号", "单号", "订单编号", "OrderID", "order_id", "ID"];
  for (let i = 0; i < preferred.length; i++) {
    if (shared.indexOf(preferred[i]) >= 0) return [preferred[i]];
  }
  if (shared.length === 1) return shared;
  throw new Error("请说明按哪一列对账，例如：按订单号对账");
}
