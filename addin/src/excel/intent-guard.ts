/** True when the user is asking to resume the previous ask, not start a new one. */
export function isContinueRequest(text: string): boolean {
  return /^(继续|接着(做|来|干)?|然后呢|再做一遍|go on|continue\.?)$/i.test(
    String(text || "").trim()
  );
}

/** If this turn is 「继续」, return the last real user ask; otherwise return the current text. */
export function resolveContinuedAsk(text: string, priorUserTexts: string[]): string {
  const current = String(text || "").trim();
  if (!isContinueRequest(current)) return current;
  for (let i = priorUserTexts.length - 1; i >= 0; i--) {
    const t = String(priorUserTexts[i] || "").trim();
    if (t && !isContinueRequest(t)) return t;
  }
  return current;
}

/** True when the user asked to create sample data first — do not steal the turn with a local shortcut. */
export function isSetupRequest(text: string): boolean {
  const t = String(text || "").trim();
  if (isSkipSampleRequest(t)) return false;
  return /生成|随机|造一?张|准备样例|创建.{0,8}表|先.*表/.test(t);
}

export function isSkipSampleRequest(text: string): boolean {
  return /不用生成|不要生成|先不要|不必生成|等我自己准备/.test(String(text || ""));
}

export const SKIP_SAMPLE_COMMAND = "不用生成，等我自己准备数据。";
export const SKIP_SAMPLE_REPLY = "好，等你在工作簿里准备好带表头的表再继续。";

export interface SampleKit {
  id: string;
  label: string;
}

export const KIT_ORDERS: SampleKit = { id: "orders", label: "订单表（订单号、类别、金额）" };
export const KIT_LEDGER: SampleKit = { id: "ledger", label: "流水表（订单号、金额）" };
export const KIT_REF: SampleKit = { id: "ref_error", label: "带 #REF! 错误的公式源" };
export const KIT_TABLE: SampleKit = { id: "table", label: "样例表（类别、金额）" };

const ALL_KITS = [KIT_ORDERS, KIT_LEDGER, KIT_REF, KIT_TABLE];

export function askGenerateSample(action: string): string {
  return (
    "当前工作簿没有带表头的表，没法" +
    action +
    "。请勾选要生成的样例，确认后才会写入。"
  );
}

export function isAskGenerateSample(text: string): boolean {
  const t = String(text || "");
  return /要我(现在)?(先)?(随机)?生成|先生成样例|回复「生成」|请问需要我先生成|请勾选要生成的样例|请选择要生成的样例/.test(t);
}

export function sampleActionForText(userText: string): string {
  const t = String(userText || "");
  if (/对账|reconcile/i.test(t)) return "对账";
  if (/\/整形/.test(t)) return "整形";
  if (/去重/.test(t)) return "去重";
  if (/反透视|unpivot/i.test(t)) return "反透视";
  if (/拆列|拆开|拆分/.test(t)) return "拆列";
  if (/#REF|修(复)?引用/.test(t)) return "修公式";
  if (/\/计算|活公式/.test(t)) return "计算";
  if (/匹配过来|lookup/i.test(t)) return "匹配";
  if (/求和|sumifs|分类汇总/i.test(t)) return "求和";
  if (/提取选中|提取.{0,12}列|大小写统一|统一大小写|规范大小写/.test(t)) return "提取列";
  return "继续";
}

export function sampleKitsForAction(action: string): SampleKit[] {
  const a = String(action || "");
  if (/对账/.test(a)) return [KIT_ORDERS, KIT_LEDGER];
  if (/修公式|匹配|求和|计算/.test(a)) return [KIT_ORDERS, KIT_LEDGER, KIT_REF];
  return [KIT_TABLE];
}

export function sampleKitsForAsk(assistantText: string, userText: string): SampleKit[] | null {
  if (!isAskGenerateSample(assistantText)) return null;
  const action = sampleActionForText(userText);
  if (action !== "继续") return sampleKitsForAction(action);
  if (/#REF|订单表|流水表/.test(assistantText)) return [KIT_ORDERS, KIT_LEDGER, KIT_REF];
  return sampleKitsForAction(sampleActionForText(assistantText));
}

export function buildGenerateCommand(kitIds: string[]): string {
  const labels = kitIds
    .map((id) => ALL_KITS.find((k) => k.id === id)?.label)
    .filter((label): label is string => !!label);
  if (labels.length === 0) return "生成样例";
  const live = kitIds.indexOf("ref_error") >= 0
    ? "。生成后按实际表头分别做 sumifs、lookup、fix_ref，全部用活公式，不写死汇总值。"
    : "。";
  return "生成" + labels.join("、") + live;
}
