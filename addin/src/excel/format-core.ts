/** Format option mapping — no Office JS. */

export type HorizontalAlign = "General" | "Left" | "Center" | "Right";
export type VerticalAlign = "Top" | "Center" | "Bottom";
export type BorderWeight = "Thin" | "Medium" | "Thick";

export type FormatOpts = {
  bold?: boolean;
  color?: string;
  bgColor?: string;
  numberFormat?: string;
  fontSize?: number;
  columnWidth?: number;
  hAlign?: HorizontalAlign;
  vAlign?: VerticalAlign;
  wrap?: boolean;
  border?: "none" | BorderWeight;
  borderColor?: string;
  rowHeight?: number;
  autoFit?: boolean;
  freezeRows?: number;
  freezeCols?: number;
};

const H_ALIGN: Record<string, HorizontalAlign> = {
  left: "Left",
  center: "Center",
  centre: "Center",
  right: "Right",
  general: "General",
};

const V_ALIGN: Record<string, VerticalAlign> = {
  top: "Top",
  center: "Center",
  centre: "Center",
  middle: "Center",
  bottom: "Bottom",
};

export const FORMAT_KEYS = [
  "bold",
  "color",
  "bgColor",
  "numberFormat",
  "fontSize",
  "columnWidth",
  "hAlign",
  "vAlign",
  "wrap",
  "wrapText",
  "border",
  "borderColor",
  "rowHeight",
  "autoFit",
  "freezeRows",
  "freezeCols",
];

export function parseHAlign(raw: unknown): HorizontalAlign | undefined {
  if (raw == null || raw === "") return undefined;
  const v = H_ALIGN[String(raw).trim().toLowerCase()];
  if (!v) throw new Error('hAlign 只能是 left|center|right|general');
  return v;
}

export function parseVAlign(raw: unknown): VerticalAlign | undefined {
  if (raw == null || raw === "") return undefined;
  const v = V_ALIGN[String(raw).trim().toLowerCase()];
  if (!v) throw new Error("vAlign 只能是 top|center|bottom");
  return v;
}

export function parseBorder(raw: unknown): FormatOpts["border"] {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === "none" || s === "off" || s === "false") return "none";
  if (s === "thin") return "Thin";
  if (s === "medium") return "Medium";
  if (s === "thick") return "Thick";
  throw new Error("border 只能是 none|thin|medium|thick");
}

export function parseFormatInput(input: Record<string, unknown>): FormatOpts {
  const out: FormatOpts = {};
  if (input.bold !== undefined) out.bold = input.bold === true || String(input.bold) === "true";
  if (input.color != null && String(input.color).trim()) out.color = String(input.color).trim();
  if (input.bgColor != null && String(input.bgColor).trim()) out.bgColor = String(input.bgColor).trim();
  if (input.numberFormat != null && String(input.numberFormat).trim()) {
    out.numberFormat = String(input.numberFormat);
  }
  if (input.fontSize != null && input.fontSize !== "") out.fontSize = Number(input.fontSize);
  if (input.columnWidth != null && input.columnWidth !== "") out.columnWidth = Number(input.columnWidth);
  const h = parseHAlign(input.hAlign);
  if (h) out.hAlign = h;
  const v = parseVAlign(input.vAlign);
  if (v) out.vAlign = v;
  if (input.wrap !== undefined || input.wrapText !== undefined) {
    const w = input.wrap !== undefined ? input.wrap : input.wrapText;
    out.wrap = w === true || String(w) === "true";
  }
  const border = parseBorder(input.border);
  if (border) out.border = border;
  if (input.borderColor != null && String(input.borderColor).trim()) {
    out.borderColor = String(input.borderColor).trim();
  }
  if (input.rowHeight != null && input.rowHeight !== "") out.rowHeight = Number(input.rowHeight);
  if (input.autoFit !== undefined) out.autoFit = input.autoFit === true || String(input.autoFit) === "true";
  if (input.freezeRows != null && input.freezeRows !== "") out.freezeRows = Math.max(0, Number(input.freezeRows) || 0);
  if (input.freezeCols != null && input.freezeCols !== "") out.freezeCols = Math.max(0, Number(input.freezeCols) || 0);
  return out;
}

/** First unfrozen cell (0-based). null = unfreeze. */
export function freezeAtCell(freezeRows?: number, freezeCols?: number): { row: number; col: number } | null | undefined {
  if (freezeRows == null && freezeCols == null) return undefined;
  const r = freezeRows || 0;
  const c = freezeCols || 0;
  if (r === 0 && c === 0) return null;
  return { row: r, col: c };
}
