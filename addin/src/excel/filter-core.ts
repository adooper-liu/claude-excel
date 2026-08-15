/** Sort/filter column keys and AutoFilter criteria — no Office JS. */

export type FilterCriteria = {
  filterOn: "custom" | "values";
  criterion1: string;
  criterion2?: string;
  operator?: "And" | "Or";
  values?: string[];
};

const OP_ALIAS: Record<string, string> = {
  greaterthan: "gt",
  gt: "gt",
  ">": "gt",
  greaterthanorequal: "gte",
  gte: "gte",
  ">=": "gte",
  lessthan: "lt",
  lt: "lt",
  "<": "lt",
  lessthanorequal: "lte",
  lte: "lte",
  "<=": "lte",
  equals: "eq",
  equal: "eq",
  eq: "eq",
  "=": "eq",
  notequal: "ne",
  ne: "ne",
  "<>": "ne",
  "!=": "ne",
  contains: "contains",
  notcontains: "notcontains",
  beginswith: "begins",
  startswith: "begins",
  endswith: "ends",
  blanks: "blank",
  blank: "blank",
  empty: "blank",
  isempty: "blank",
  nonblanks: "nonblank",
  notblank: "nonblank",
  notempty: "nonblank",
  between: "between",
};

export function letterToIndex(letter: string): number {
  const s = String(letter || "").trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) throw new Error('不是列字母: "' + letter + '"');
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function headerIndex(headers: string[] | undefined, name: string): number {
  const list = headers || [];
  const q = String(name || "").trim();
  const exact = list.findIndex(function (h) {
    return String(h || "").trim() === q;
  });
  if (exact >= 0) return exact;
  const lower = q.toLowerCase();
  return list.findIndex(function (h) {
    return String(h || "").trim().toLowerCase() === lower;
  });
}

/** 0-based index inside the range. Letters are worksheet columns (A=0), then subtract rangeStartCol. */
export function columnKeyToIndex(
  column: string,
  headers?: string[],
  rangeStartCol = 0
): number {
  const raw = String(column || "").trim();
  if (!raw) throw new Error("column required");
  if (/^[A-Za-z]+$/.test(raw)) {
    const abs = letterToIndex(raw);
    const rel = abs - rangeStartCol;
    if (rel < 0) throw new Error('列 ' + raw.toUpperCase() + " 不在当前区域内");
    return rel;
  }
  if (/^\d+$/.test(raw)) {
    const n = parseInt(raw, 10);
    if (n < 1) throw new Error("column 从 1 起");
    return n - 1;
  }
  const hi = headerIndex(headers, raw);
  if (hi >= 0) return hi;
  throw new Error('找不到列 "' + raw + '"');
}

export function normalizeFilterOp(operator: string): string {
  const raw = String(operator || "").trim();
  const key = raw.toLowerCase().replace(/[\s_-]/g, "");
  if (OP_ALIAS[key]) return OP_ALIAS[key];
  if (OP_ALIAS[raw]) return OP_ALIAS[raw];
  throw new Error('不支持的筛选运算符: "' + operator + '"');
}

export function mapFilterOperator(operator: string, value?: string, value2?: string): FilterCriteria {
  const op = normalizeFilterOp(operator);
  const v = value == null ? "" : String(value);
  if (op === "blank") return { filterOn: "custom", criterion1: "=" };
  if (op === "nonblank") return { filterOn: "custom", criterion1: "<>" };
  if (op === "gt") return { filterOn: "custom", criterion1: ">" + v };
  if (op === "gte") return { filterOn: "custom", criterion1: ">=" + v };
  if (op === "lt") return { filterOn: "custom", criterion1: "<" + v };
  if (op === "lte") return { filterOn: "custom", criterion1: "<=" + v };
  if (op === "ne") return { filterOn: "custom", criterion1: "<>" + v };
  if (op === "contains") return { filterOn: "custom", criterion1: "*" + v + "*" };
  if (op === "notcontains") return { filterOn: "custom", criterion1: "<>*" + v + "*" };
  if (op === "begins") return { filterOn: "custom", criterion1: v + "*" };
  if (op === "ends") return { filterOn: "custom", criterion1: "*" + v };
  if (op === "between") {
    const v2 = value2 == null ? "" : String(value2);
    return { filterOn: "custom", criterion1: ">=" + v, criterion2: "<=" + v2, operator: "And" };
  }
  return { filterOn: "values", criterion1: v, values: [v] };
}
