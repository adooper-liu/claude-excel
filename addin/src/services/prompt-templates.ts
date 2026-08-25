import { API_BASE } from "./api-config";

export type PromptTemplate = { id: string; title: string; prompt: string; custom?: boolean };

export const CUSTOM_PROMPTS_LS_KEY = "claude_excel_custom_prompts";
export const TEMPLATES_API = API_BASE + "/api/templates";

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
  {
    id: "reshape-fetch",
    title: "规整取数列",
    prompt:
      "inspect 当前取数表表头。用 reshape_table op=project（有 recipe 模板时 headerless:true）把列映射成规范列名，只写新表不改源表。列位置必须来自 inspect，不要猜。",
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

export function makeCustomTemplateId(): string {
  return "u_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function normalizeCustomList(raw: unknown): PromptTemplate[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(function (item) {
      if (!item || typeof item !== "object") return null;
      const c = item as { id?: string; title?: string; prompt?: string };
      const id = String(c.id || "").trim();
      const title = String(c.title || "").trim();
      const prompt = String(c.prompt || "").trim();
      if (!id || !title || !prompt) return null;
      return { id, title, prompt, custom: true as const };
    })
    .filter(Boolean) as PromptTemplate[];
}

export function readCustomTemplatesFromStorage(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PROMPTS_LS_KEY);
    if (!raw) return [];
    return normalizeCustomList(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeCustomTemplatesToStorage(items: PromptTemplate[]): void {
  try {
    const payload = items.map(function (p) {
      return { id: p.id, title: p.title, prompt: p.prompt };
    });
    localStorage.setItem(CUSTOM_PROMPTS_LS_KEY, JSON.stringify(payload));
  } catch {
    /* ignore quota */
  }
}

export async function loadCustomTemplates(): Promise<PromptTemplate[]> {
  try {
    const r = await fetch(TEMPLATES_API);
    if (r.ok) {
      const data = (await r.json()) as { templates?: unknown[] };
      const items = normalizeCustomList(data.templates);
      writeCustomTemplatesToStorage(items);
      return items;
    }
  } catch {
    /* backend down */
  }
  return readCustomTemplatesFromStorage();
}

export async function saveCustomTemplates(items: PromptTemplate[]): Promise<PromptTemplate[]> {
  const payload = items.map(function (p) {
    return { id: p.id, title: p.title, prompt: p.prompt };
  });
  writeCustomTemplatesToStorage(items);
  try {
    const r = await fetch(TEMPLATES_API, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ templates: payload }),
    });
    if (r.ok) {
      const data = (await r.json()) as { templates?: unknown[] };
      const saved = normalizeCustomList(data.templates);
      writeCustomTemplatesToStorage(saved);
      return saved.length ? saved : items;
    }
  } catch {
    /* keep local copy */
  }
  return items;
}
