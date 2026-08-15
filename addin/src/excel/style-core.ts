/** In-product palettes and number formats. Names and hex values are original to this add-in. */

export type PaletteId = "moqing" | "nuansha" | "shuangbai" | "yehang" | "zhusha";
export type NumberPreset = "yuan" | "currency" | "percent" | "thousands";

export type SheetPalette = {
  id: PaletteId;
  name: string;
  blurb: string;
  headerFill: string;
  headerFont: string;
  bodyFont: string;
  accent: string;
  series: string[];
};

export const PALETTES: Record<PaletteId, SheetPalette> = {
  moqing: {
    id: "moqing",
    name: "墨青",
    blurb: "深青表头，适合日常对账底稿",
    headerFill: "#1F4E5F",
    headerFont: "#FFFFFF",
    bodyFont: "#1A202C",
    accent: "#3D8B8B",
    series: ["#1F4E5F", "#3D8B8B", "#C4A35A", "#9B2C2C", "#4A5568"],
  },
  nuansha: {
    id: "nuansha",
    name: "暖砂",
    blurb: "暖褐表头，适合汇报给人看的表",
    headerFill: "#8B6914",
    headerFont: "#FFF8E7",
    bodyFont: "#3D2B1F",
    accent: "#C4A35A",
    series: ["#8B6914", "#C4A35A", "#1F4E5F", "#9B2C2C", "#4A5568"],
  },
  shuangbai: {
    id: "shuangbai",
    name: "霜白",
    blurb: "灰表头，打印黑白也清楚",
    headerFill: "#4A5568",
    headerFont: "#FFFFFF",
    bodyFont: "#1A202C",
    accent: "#718096",
    series: ["#4A5568", "#718096", "#1F4E5F", "#8B6914", "#9B2C2C"],
  },
  yehang: {
    id: "yehang",
    name: "夜航",
    blurb: "藏青表头，适合指标看板",
    headerFill: "#1A365D",
    headerFont: "#E2E8F0",
    bodyFont: "#1A202C",
    accent: "#2B6CB0",
    series: ["#1A365D", "#2B6CB0", "#38A169", "#C53030", "#D69E2E"],
  },
  zhusha: {
    id: "zhusha",
    name: "朱砂",
    blurb: "红表头，适合差异和预警列",
    headerFill: "#9B2C2C",
    headerFont: "#FFFFFF",
    bodyFont: "#1A202C",
    accent: "#C53030",
    series: ["#9B2C2C", "#C53030", "#1F4E5F", "#8B6914", "#4A5568"],
  },
};

export const NUMBER_PRESETS: Record<NumberPreset, { format: string; note: string }> = {
  yuan: { format: '¥#,##0.00;¥(#,##0.00);-', note: "人民币，零显示为 -" },
  currency: { format: '#,##0.00;(#,##0.00);-', note: "千分位，负数括号，零为 -" },
  percent: { format: "0.0%", note: "单元格里存 0.15，显示 15.0%；不要写入 15" },
  thousands: { format: '#,##0;(#,##0);-', note: "整数千分位" },
};

export function resolvePalette(id?: string): SheetPalette {
  const raw = String(id || "").trim();
  if (!raw) {
    throw new Error(
      "未指定配色。请先让用户选一套：墨青 moqing、暖砂 nuansha、霜白 shuangbai、夜航 yehang、朱砂 zhusha"
    );
  }
  const key = raw as PaletteId;
  if (PALETTES[key]) return PALETTES[key];
  const byName = Object.values(PALETTES).find((p) => p.name === raw);
  if (byName) return byName;
  throw new Error(
    "未知配色「" +
      raw +
      "」。可选：墨青 moqing、暖砂 nuansha、霜白 shuangbai、夜航 yehang、朱砂 zhusha"
  );
}

export function resolveNumberPreset(id?: string): { id: NumberPreset; format: string; note: string } {
  const key = String(id || "").trim() as NumberPreset;
  if (key && NUMBER_PRESETS[key]) return { id: key, ...NUMBER_PRESETS[key] };
  const aliases: Record<string, NumberPreset> = {
    人民币: "yuan",
    金额: "yuan",
    货币: "currency",
    百分比: "percent",
    百分数: "percent",
    千分位: "thousands",
  };
  const mapped = aliases[String(id || "").trim()];
  if (mapped) return { id: mapped, ...NUMBER_PRESETS[mapped] };
  throw new Error("未知数字格式「" + String(id || "") + "」。可选：yuan / currency / percent / thousands");
}

export function listPalettes(): Array<{ id: PaletteId; name: string; blurb: string }> {
  return Object.values(PALETTES).map((p) => ({ id: p.id, name: p.name, blurb: p.blurb }));
}
