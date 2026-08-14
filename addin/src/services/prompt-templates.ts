export type PromptTemplate = { id: string; title: string; prompt: string; custom?: boolean };

export const BUILTIN_PROMPTS: PromptTemplate[] = [
  {
    id: "sample",
    title: "生成样本数据",
    prompt:
      "先随机生成两张小表：订单（订单号,类别,金额）和流水（订单号,金额），各 5 行。写成 Excel Table 后停下来，用中文告诉我表名。",
  },
  {
    id: "monthly",
    title: "月度报告",
    prompt: "读取当前工作簿里的表，写一份月度报告到新表「月度报告」：概况、关键指标、异常。不要覆盖源表。",
  },
  {
    id: "pivot",
    title: "透视分析",
    prompt: "inspect 当前表，按类别对金额做 SUMIFS 汇总，写到新表，公式保持活的。",
  },
  {
    id: "clean",
    title: "清洗脏数据",
    prompt: "inspect 当前表，去重并去掉首尾空格，结果写到新表，不要改源表。",
  },
];

export function mergeTemplates(
  builtins: PromptTemplate[],
  custom: Array<{ id?: string; title?: string; prompt?: string }>
): PromptTemplate[] {
  const seen = new Set(builtins.map((p) => p.id));
  const extra: PromptTemplate[] = [];
  for (const c of custom || []) {
    const id = String(c.id || "").trim();
    const title = String(c.title || "").trim();
    const prompt = String(c.prompt || "").trim();
    if (!id || !title || !prompt || seen.has(id)) continue;
    seen.add(id);
    extra.push({ id, title, prompt, custom: true });
  }
  return builtins.concat(extra);
}
