/** AutoFill destination math — no Office JS. Indexes are 0-based. */

export type FillType = "default" | "copy" | "series" | "formats" | "values";

const FILL_ALIAS: Record<string, FillType> = {
  default: "default",
  filldefault: "default",
  copy: "copy",
  fillcopy: "copy",
  formulas: "copy",
  formula: "copy",
  series: "series",
  fillseries: "series",
  formats: "formats",
  fillformats: "formats",
  values: "values",
  fillvalues: "values",
};

export function parseFillType(raw?: string): FillType {
  if (raw == null || String(raw).trim() === "") return "default";
  const key = String(raw).trim().toLowerCase().replace(/[\s_-]/g, "");
  const t = FILL_ALIAS[key];
  if (!t) throw new Error("fillType 只能是 default|copy|series|formats|values");
  return t;
}

export type FillBox = { row: number; col: number; rowCount: number; colCount: number };

export function expandFillDown(source: FillBox, lastUsedRow: number): FillBox {
  if (lastUsedRow < source.row) {
    throw new Error("工作表没有可用的末行，无法向下填充");
  }
  const destRows = lastUsedRow - source.row + 1;
  if (destRows <= source.rowCount) {
    throw new Error("目标区域不比源区域大，没有可填充的格子");
  }
  return {
    row: source.row,
    col: source.col,
    rowCount: destRows,
    colCount: source.colCount,
  };
}

export function expandFillRight(source: FillBox, lastUsedCol: number): FillBox {
  if (lastUsedCol < source.col) {
    throw new Error("工作表没有可用的末列，无法向右填充");
  }
  const destCols = lastUsedCol - source.col + 1;
  if (destCols <= source.colCount) {
    throw new Error("目标区域不比源区域大，没有可填充的格子");
  }
  return {
    row: source.row,
    col: source.col,
    rowCount: source.rowCount,
    colCount: destCols,
  };
}
