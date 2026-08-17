/** Infer column formats from headers + samples; apply on reshape write. Pure — no Office JS. */

import { indexToCol } from "./formula-inspect-core";
import { dayToIso, parseDateCell } from "./date-cell";
import type { Cell } from "./reshape-core";

export type ColumnKind = "id_text" | "datetime" | "number" | "amount" | "percent" | "plain_text";

export interface ColumnFormatHint {
  index: number;
  letter: string;
  header: string;
  kind: ColumnKind;
  hint: string;
  excelFormat?: string;
}

const ID_HEADER = /单号|编号|号码|面单|运单|order\s*id|waybill|tracking|快递|sku/i;
const NON_ID_HEADER = /时间|日期|时区|timestamp|date/i;
const DATETIME_HEADER = /时间|日期|timestamp|date|utc|gmt|时区/i;
const AMOUNT_HEADER = /金额|amount|price|售价|成本|cost|fee|运费|单价/i;
const PERCENT_HEADER = /率|percent|ratio|占比/i;

function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function looksScientificText(text: string): boolean {
  return /e[+-]?\d+$/i.test(String(text || "").trim());
}

export function numberToPlainText(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0, useGrouping: false });
  }
  return value.toLocaleString("en-US", { maximumFractionDigits: 20, useGrouping: false });
}

export function isIdLikeHeader(header: string): boolean {
  const h = String(header || "").trim();
  if (!h || NON_ID_HEADER.test(h)) return false;
  return ID_HEADER.test(h);
}

function looksLikeDatetimeSample(s: string): boolean {
  if (!s) return false;
  return (
    /^\d{4}[-/]\d{1,2}[-/]\d/.test(s) ||
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(s) ||
    /^\d{4}-\d{2}-\d{2}T/.test(s) ||
    /GMT|UTC|[+-]\d{2}:\d{2}$/.test(s)
  );
}

function looksLikeIdSample(s: string): boolean {
  if (!s) return false;
  if (/^[A-Za-z]{1,4}\d{8,}$/.test(s)) return true;
  if (/^\d{11,}$/.test(s)) return true;
  if (/^[A-Za-z0-9-]{12,}$/.test(s) && /\d/.test(s)) return true;
  return false;
}

function looksLikeAmountSample(s: string): boolean {
  if (!s) return false;
  return /^-?[\d,]+(\.\d+)?$/.test(s.replace(/[¥$€,\s]/g, ""));
}

function columnSamples(sampleRows: unknown[][], col: number): string[] {
  const out: string[] = [];
  (sampleRows || []).forEach(function (row) {
    const s = cellStr(Array.isArray(row) ? row[col] : "");
    if (s) out.push(s);
  });
  return out.slice(0, 12);
}

function rate(samples: string[], pred: (s: string) => boolean): number {
  if (!samples.length) return 0;
  let hit = 0;
  samples.forEach(function (s) {
    if (pred(s)) hit += 1;
  });
  return hit / samples.length;
}

function kindHint(kind: ColumnKind): string {
  if (kind === "id_text") return "单号/长数字 → 文本 @，避免科学计数法";
  if (kind === "datetime") return "日期时间 → 原样保留，不统一时区";
  if (kind === "amount") return "金额 → 转数字";
  if (kind === "number") return "数值 → 转数字";
  if (kind === "percent") return "比例 → 保持原值";
  return "文本 → 去首尾空格";
}

function inferKind(header: string, samples: string[]): ColumnKind {
  const h = String(header || "").trim();
  if (isIdLikeHeader(h) || rate(samples, looksLikeIdSample) >= 0.5) return "id_text";
  if (DATETIME_HEADER.test(h) || rate(samples, looksLikeDatetimeSample) >= 0.4) return "datetime";
  if (AMOUNT_HEADER.test(h)) return "amount";
  if (
    rate(samples, looksLikeAmountSample) >= 0.6 &&
    rate(samples, looksLikeDatetimeSample) < 0.2
  ) {
    return "amount";
  }
  if (PERCENT_HEADER.test(h) && !/效率|概率/.test(h)) return "percent";
  const numeric = rate(samples, function (s) {
    return /^-?[\d,]+(\.\d+)?$/.test(s.replace(/,/g, ""));
  });
  if (numeric >= 0.7 && !DATETIME_HEADER.test(h)) return "number";
  return "plain_text";
}

export function inferColumnFormats(
  headers: string[],
  sampleRows: unknown[][]
): ColumnFormatHint[] {
  return headers.map(function (header, index) {
    const samples = columnSamples(sampleRows, index);
    const kind = inferKind(header, samples);
    const hint: ColumnFormatHint = {
      index: index,
      letter: indexToCol(index),
      header: String(header || "").trim(),
      kind: kind,
      hint: kindHint(kind),
    };
    if (kind === "id_text") hint.excelFormat = "@";
    return hint;
  });
}

export function textColumnIndexes(hints: ColumnFormatHint[]): number[] {
  return hints
    .filter(function (h) {
      return h.kind === "id_text" || h.excelFormat === "@";
    })
    .map(function (h) {
      return h.index;
    });
}

export function textColumnIndexesFromHeaders(headers: string[]): number[] {
  return textColumnIndexes(inferColumnFormats(headers, []));
}

/** @deprecated use textColumnIndexesFromHeaders */
export function idLikeColumnIndexes(headers: string[]): number[] {
  return textColumnIndexesFromHeaders(headers);
}

export function resolveIdCell(value: Cell, displayedText: string): string {
  const text = String(displayedText ?? "").trim();
  if (text && /^\d+$/.test(text)) return text;
  if (text && !looksScientificText(text)) return text;
  if (typeof value === "number" && Number.isFinite(value)) return numberToPlainText(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function coerceNumberCell(value: Cell): { value: Cell; converted: boolean; blanked: boolean } {
  if (value === null || value === undefined || value === "") {
    return { value: null, converted: false, blanked: false };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value: value, converted: false, blanked: false };
  }
  const s = String(value).trim().replace(/,/g, "").replace(/[¥$€]/g, "");
  if (s === "") return { value: null, converted: false, blanked: true };
  const n = Number(s);
  if (Number.isFinite(n)) return { value: n, converted: true, blanked: false };
  return { value: null, converted: false, blanked: true };
}

export function applyFormatToCell(value: Cell, kind: ColumnKind, displayedText?: string): Cell {
  if (kind === "id_text") return resolveIdCell(value, displayedText || "");
  if (kind === "datetime") {
    if (value === null || value === undefined) return "";
    const day = parseDateCell(value);
    return day === null ? "" : dayToIso(day);
  }
  if (kind === "number" || kind === "amount") {
    return coerceNumberCell(value).value;
  }
  if (kind === "percent") {
    if (value === null || value === undefined) return "";
    return typeof value === "number" ? value : String(value).trim();
  }
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function coerceRowByFormats(
  row: Cell[],
  hints: ColumnFormatHint[],
  textRow?: string[]
): Cell[] {
  const next = row.slice();
  hints.forEach(function (spec) {
    const i = spec.index;
    next[i] = applyFormatToCell(next[i] ?? null, spec.kind, textRow ? textRow[i] || "" : "");
  });
  return next;
}

export function coerceGridByFormats(
  rows: Cell[][],
  hints: ColumnFormatHint[],
  textRows?: string[][]
): { rows: Cell[][]; converted: number; blanked: number } {
  let converted = 0;
  let blanked = 0;
  const out = rows.map(function (row, ri) {
    const before = row.slice();
    const next = coerceRowByFormats(before, hints, textRows ? textRows[ri] : undefined);
    hints.forEach(function (spec, _j) {
      const i = spec.index;
      if ((spec.kind === "number" || spec.kind === "amount") && before[i] !== next[i]) {
        if (next[i] === null) blanked += 1;
        else converted += 1;
      }
    });
    return next;
  });
  return { rows: out, converted: converted, blanked: blanked };
}

export function gridCellsForWrite(rows: Cell[][], hints: ColumnFormatHint[]): (string | number)[][] {
  const textCols = new Set(textColumnIndexes(hints));
  return rows.map(function (row) {
    return row.map(function (c, col) {
      if (c === null || c === undefined) return "";
      if (textCols.has(col)) return String(c).trim();
      return c as string | number;
    });
  });
}

/** @deprecated use coerceRowByFormats */
export function coerceRowIdCells(row: Cell[], idCols: number[], textRow?: string[]): Cell[] {
  const hints = idCols.map(function (col) {
    return {
      index: col,
      letter: indexToCol(col),
      header: "",
      kind: "id_text" as ColumnKind,
      hint: kindHint("id_text"),
      excelFormat: "@",
    };
  });
  return coerceRowByFormats(row, hints, textRow);
}

/** @deprecated use gridCellsForWrite */
export function gridIdCellsAsText(rows: Cell[][], headers: string[]): (string | number)[][] {
  return gridCellsForWrite(rows, inferColumnFormats(headers, []));
}
