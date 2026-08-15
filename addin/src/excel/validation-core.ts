/** Data-validation rule mapping — no Office JS. */

export type ValidationType = "list" | "whole" | "decimal" | "date" | "textLength" | "custom" | "clear";

const TYPE_ALIAS: Record<string, ValidationType> = {
  list: "list",
  dropdown: "list",
  drop: "list",
  whole: "whole",
  integer: "whole",
  decimal: "decimal",
  number: "decimal",
  date: "date",
  textlength: "textLength",
  length: "textLength",
  custom: "custom",
  formula: "custom",
  clear: "clear",
  none: "clear",
  off: "clear",
};

const OP_ALIAS: Record<string, string> = {
  between: "Between",
  notbetween: "NotBetween",
  equal: "EqualTo",
  equals: "EqualTo",
  eq: "EqualTo",
  notequal: "NotEqualTo",
  ne: "NotEqualTo",
  greaterthan: "GreaterThan",
  gt: "GreaterThan",
  greaterthanorequal: "GreaterThanOrEqual",
  gte: "GreaterThanOrEqual",
  lessthan: "LessThan",
  lt: "LessThan",
  lessthanorequal: "LessThanOrEqual",
  lte: "LessThanOrEqual",
};

export function parseValidationType(raw: string): ValidationType {
  const key = String(raw || "").trim().toLowerCase().replace(/[\s_-]/g, "");
  const t = TYPE_ALIAS[key];
  if (!t) throw new Error("data_validation type 只能是 list|whole|decimal|date|textLength|custom|clear");
  return t;
}

export function parseValidationOperator(raw?: string): string {
  if (raw == null || String(raw).trim() === "") return "Between";
  const key = String(raw).trim().toLowerCase().replace(/[\s_-]/g, "");
  const op = OP_ALIAS[key];
  if (!op) throw new Error('不支持的验证运算符: "' + raw + '"');
  return op;
}

export type ValidationRule =
  | { kind: "clear" }
  | {
      kind: "rule";
      rule: Record<string, unknown>;
      errorMessage?: string;
      allowBlank?: boolean;
    };

export function buildValidationRule(input: {
  type: string;
  source?: string;
  operator?: string;
  formula1?: string;
  formula2?: string;
  formula?: string;
  errorMessage?: string;
  allowBlank?: boolean;
}): ValidationRule {
  const type = parseValidationType(input.type);
  if (type === "clear") return { kind: "clear" };
  if (type === "list") {
    const source = String(input.source || input.formula1 || "").trim();
    if (!source) throw new Error("list 需要 source，例如 是,否 或 =假设!$A$1:$A$10");
    return {
      kind: "rule",
      rule: { list: { inCellDropDown: true, source } },
      errorMessage: input.errorMessage,
      allowBlank: input.allowBlank,
    };
  }
  if (type === "custom") {
    const formula = String(input.formula || input.formula1 || "").trim();
    if (!formula) throw new Error("custom 需要 formula");
    return {
      kind: "rule",
      rule: { custom: { formula } },
      errorMessage: input.errorMessage,
      allowBlank: input.allowBlank,
    };
  }
  const operator = parseValidationOperator(input.operator);
  const formula1 = String(input.formula1 || "").trim();
  if (!formula1) throw new Error(type + " 需要 formula1");
  const needsSecond = operator === "Between" || operator === "NotBetween";
  const formula2 = String(input.formula2 || "").trim();
  if (needsSecond && !formula2) throw new Error(type + " 的 between 需要 formula2");
  const inner: Record<string, unknown> = { formula1, operator };
  if (formula2) inner.formula2 = formula2;
  const key =
    type === "whole" ? "wholeNumber" : type === "textLength" ? "textLength" : type;
  return {
    kind: "rule",
    rule: { [key]: inner },
    errorMessage: input.errorMessage,
    allowBlank: input.allowBlank,
  };
}
