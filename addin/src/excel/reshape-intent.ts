import { isSetupRequest } from "./intent-guard";

export interface SourceSheet {
  name: string;
  range: string | null;
  rows: number;
  headers: string[];
  tableNames: string[];
}

export type ReshapeOp = "dedupe" | "unpivot" | "split" | "coerce" | "project" | "flatten_header";
export type CoerceType = "number" | "text" | "date";

export interface ReshapeIntent {
  op: ReshapeOp;
  keys?: string[];
  column?: string;
  separator?: string;
  type?: CoerceType;
}

export function isProjectReshapeRequest(text: string): boolean {
  const t = String(text || "").trim();
  if (isSetupRequest(t)) return false;
  if (/对账|reconcile/i.test(t)) return false;
  return /规整|整理.{0,12}列|列映射|投影|\bproject\b/i.test(t);
}

export function isFlattenHeaderRequest(text: string): boolean {
  const t = String(text || "").trim();
  if (isSetupRequest(t)) return false;
  if (/对账|reconcile/i.test(t)) return false;
  return (
    /拍平.{0,8}表头|双层表头|合并表头|多行表头|一行表头|flatten_header/i.test(t) ||
    (/表头/.test(t) && /拍平|合并|双层|一行/.test(t))
  );
}

export function isReshapeRequest(text: string): boolean {
  if (isFlattenHeaderRequest(text)) return false;
  if (isProjectReshapeRequest(text)) return false;
  const t = String(text || "").trim();
  if (isSetupRequest(t)) return false;
  if (/对账|reconcile/i.test(t)) return false;
  return (
    /按.{1,20}去重/.test(t) ||
    /帮我去重|做去重|去重一下|\bdedupe\b/i.test(t) ||
    /反透视|转长表|\bunpivot\b/i.test(t) ||
    /拆开|拆列|拆分/.test(t) ||
    /转成数字|转数字|\bcoerce\b/i.test(t)
  );
}

function sepFromWord(word: string): string {
  if (/逗号|comma|，|,/i.test(word)) return ",";
  if (/;|；/.test(word)) return ";";
  if (word === "|") return "|";
  return word;
}

export function parseReshapeIntent(text: string): ReshapeIntent {
  const t = String(text || "").trim();
  const dedupe = t.match(/按\s*([^，,]+?)\s*去重/);
  if (dedupe) return { op: "dedupe", keys: [dedupe[1].trim()] };
  if (/去重|\bdedupe\b/i.test(t)) return { op: "dedupe" };

  if (/反透视|转长表|\bunpivot\b/i.test(t)) return { op: "unpivot" };

  const split = t.match(/把\s*([^，,\s]+?)\s*按\s*(逗号|comma|,|，|;|；|\|)\s*拆/);
  if (split) {
    return { op: "split", column: split[1].trim(), separator: sepFromWord(split[2]) };
  }
  if (/拆开|拆列|拆分/.test(t)) {
    const col = t.match(/把\s*([^，,\s]+)/);
    return { op: "split", column: col ? col[1].trim() : undefined, separator: "," };
  }

  const coerce = t.match(/把\s*([^，,\s]+?)\s*转成?(数字|数值|number|文本|日期)/);
  if (coerce) {
    const raw = coerce[2];
    const type: CoerceType = /数字|数值|number/i.test(raw)
      ? "number"
      : /日期|date/i.test(raw)
        ? "date"
        : "text";
    return { op: "coerce", column: coerce[1].trim(), type: type };
  }
  if (/转成数字|转数字/.test(t)) return { op: "coerce", type: "number" };

  if (/规整|整理.{0,12}列|列映射|投影|\bproject\b/i.test(t)) {
    return { op: "project" };
  }

  throw new Error("请说明要去重、反透视、拆列、转数字还是规整列（project）");
}

const RESULT_SHEET = /对账|去重结果|反透视|拆列|类型结果|映射结果|拍平结果|reshape|reconcile|_规范|提取结果/i;

export function pickSourceSheet(sheets: SourceSheet[], intent: ReshapeIntent): SourceSheet | null {
  const candidates = sheets.filter(function (s) {
    return s.rows > 1 && s.headers.length > 0 && !RESULT_SHEET.test(s.name);
  });
  let pool = candidates;
  if (intent.keys && intent.keys.length) {
    const withKey = candidates.filter(function (s) {
      return intent.keys!.every(function (k) {
        return s.headers.indexOf(k) >= 0;
      });
    });
    if (withKey.length) pool = withKey;
  } else if (intent.column) {
    const withCol = candidates.filter(function (s) {
      return s.headers.indexOf(intent.column!) >= 0;
    });
    if (withCol.length) pool = withCol;
  }
  if (pool.length === 1) return pool[0];
  if (pool.length === 0) return null;
  throw new Error(
    "有多张可整形的表：" +
      pool
        .map(function (s) {
          return s.name;
        })
        .join("、") +
      "。请先只留要处理的那张。"
  );
}
