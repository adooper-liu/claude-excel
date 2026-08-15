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
    prompt: "inspect 当前表，按实际表头用 create_pivot 做透视（行字段用分类列，值字段用金额等求和）。不要猜列名。",
  },
  {
    id: "clean",
    title: "清洗脏数据",
    prompt: "inspect 当前表，去重并去掉首尾空格，结果写到新表，不要改源表。",
  },
  {
    id: "craft",
    title: "规范当前表",
    prompt: "先 inspect 再检查公式错误。输入数字用蓝字、同表公式黑字、跨表公式绿字。金额用人民币格式。不要覆盖源表数值，汇总值必须是活公式。",
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
