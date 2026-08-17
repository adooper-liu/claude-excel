/** Pure date-cell helpers — no Office JS. Unify Excel serial / yyyymmdd / ISO string dates. */

export type Cell = string | number | boolean | null;

const DAY_MS = 86400000;
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30); // Excel 序列号 0 = 1899-12-30

function pad2(n: string): string {
  return n.length === 1 ? "0" + n : n;
}

function ymdToDay(y: number, mo: number, d: number): number | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return Math.round((t - EXCEL_EPOCH_UTC) / DAY_MS);
}

/**
 * 识别 Excel 序列号（1–60000）/ yyyymmdd（8 位数字）/ ISO 字符串，返回 Excel 天数；
 * 非日期返回 null。数字优先判 yyyymmdd，避免 20240105 被当成序列号。
 */
export function parseDateCell(value: Cell | Date): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    if (Number.isNaN(t)) return null;
    return Math.round((t - EXCEL_EPOCH_UTC) / DAY_MS);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    if (value >= 19000101 && value <= 20991231) {
      const n = Math.floor(value);
      return ymdToDay(Math.floor(n / 10000), Math.floor(n / 100) % 100, n % 100);
    }
    if (value >= 1 && value <= 60000) {
      return Math.round(value);
    }
    return null;
  }
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return null;
    if (/^\d{8}$/.test(s)) {
      return ymdToDay(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
    }
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) {
      return ymdToDay(Number(m[1]), Number(m[2]), Number(m[3]));
    }
    const t = Date.parse(s);
    if (Number.isNaN(t)) return null;
    return Math.round((t - EXCEL_EPOCH_UTC) / DAY_MS);
  }
  return null;
}

/** Excel 天数（序列号）→ "YYYY-MM-DD" */
export function dayToIso(day: number): string {
  if (!Number.isFinite(day)) return "";
  const t = EXCEL_EPOCH_UTC + Math.round(day) * DAY_MS;
  const d = new Date(t);
  return d.getUTCFullYear() + "-" + pad2(String(d.getUTCMonth() + 1)) + "-" + pad2(String(d.getUTCDate()));
}
