/** Refuse writes that would overwrite formula cells. No Office JS. */

import { isFormulaText } from "./formula-inspect-core";

export type InputWrite = { address: string; value: string | number | boolean };

export function normalizeA1(address: string): string {
  return String(address || "").trim().replace(/\$/g, "").toUpperCase();
}

export function blockedFormulaCells(
  formulasByA1: Record<string, string>,
  cells: InputWrite[]
): Array<{ address: string; formula: string }> {
  const blocked: Array<{ address: string; formula: string }> = [];
  for (const cell of cells || []) {
    const a1 = normalizeA1(cell.address);
    const f = formulasByA1[a1] || formulasByA1[cell.address] || "";
    if (isFormulaText(f)) blocked.push({ address: a1, formula: String(f) });
  }
  return blocked;
}

export function assertWritableInputs(
  formulasByA1: Record<string, string>,
  cells: InputWrite[]
): void {
  const blocked = blockedFormulaCells(formulasByA1, cells);
  if (blocked.length === 0) return;
  const list = blocked.map((b) => b.address + " 是公式 " + b.formula).join("；");
  throw new Error("write_inputs 拒绝覆盖公式格: " + list + "。只改进入格（蓝字/黄底数字）。");
}
