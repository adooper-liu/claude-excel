/** Pure reconcile logic — no Office JS. exact | normalize | date_window; blank keys never match. */

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type ReconcileStatus = "matched" | "left_only" | "right_only" | "conflict";
export type KeyNormalizeMode = "trim" | "trim_lower" | "trim_collapse_ws";
export type MatchMode = "exact" | "normalize" | "date_window";
export type MatchLabel = "exact" | "date_window" | "left_only" | "right_only" | "conflict";

export interface ReconcileInput {
  leftHeaders: string[];
  leftRows: Cell[][];
  rightHeaders: string[];
  rightRows: Cell[][];
  keys: string[];
  compareColumns?: string[];
  /** exact (default) | normalize | date_window */
  matchMode?: MatchMode;
  /** Key normalization for normalize / date_window stages. Default trim. */
  keyNormalize?: KeyNormalizeMode;
  /** Only with matchMode=date_window: ±N days window for second-pass pairing. */
  dateWindowDays?: number;
  /** Left date column header; must be one of keys when matchMode=date_window. */
  leftDateKey?: string;
  /** Right date column header; must be one of keys when matchMode=date_window. */
  rightDateKey?: string;
  /** Append __match_mode / __match_score / __review. Default: true when matchMode !== "exact". */
  auditColumns?: boolean;
}

export interface ReconcileRow {
  status: ReconcileStatus;
  key: string;
  left: Row | null;
  right: Row | null;
  conflictColumns?: string[];
  matchMode?: MatchLabel;
  score?: number;
  review?: "auto" | "需复核";
}

export interface ReconcileResult {
  rows: ReconcileRow[];
  counts: Record<ReconcileStatus, number>;
  reviewPending: number;
  outputHeaders: string[];
  outputRows: Cell[][];
}

export function normalizeKeyPart(value: Cell, mode: KeyNormalizeMode = "trim"): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (mode === "trim_lower") return s.trim().toLowerCase();
  if (mode === "trim_collapse_ws") return s.trim().replace(/\s+/g, " ");
  return s.trim();
}

export function rowsToObjects(headers: string[], rows: Cell[][]): Row[] {
  return rows.map((cells) => {
    const obj: Row = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? null;
    });
    return obj;
  });
}

export function rowKey(row: Row, keys: string[], mode: KeyNormalizeMode = "trim"): string {
  return keys.map((k) => normalizeKeyPart(row[k] ?? null, mode)).join("\x1f");
}

function isBlankKey(key: string): boolean {
  return key.length === 0 || key.split("\x1f").every((p) => p === "");
}

function cellEqual(a: Cell, b: Cell): boolean {
  return normalizeKeyPart(a) === normalizeKeyPart(b);
}

function compareRow(left: Row, right: Row, columns: string[]): string[] {
  return columns.filter((c) => !cellEqual(left[c] ?? null, right[c] ?? null));
}

/** Parse a date cell to a day number (Excel serial for numbers, YYYY-MM-DD / YYYY/M/D for strings). */
function dateToDay(value: unknown): number | null {
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : Math.round(t / 86400000);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value) : null;
  }
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return Math.round(Date.UTC(y, mo - 1, d) / 86400000);
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.round(t / 86400000);
}

interface PhaseResult {
  left: Row[];
  right: Row[];
}

interface HashPhaseOptions {
  emitRemainder: boolean;
}

/**
 * Stage A/B — hash pairing on (normalized) composite keys.
 * Same-key rows pair by compare-column equality first (order-independent);
 * leftover same-key pairs become conflict; the rest are left/right only.
 */
function hashPairPhase(
  leftRows: Row[],
  rightRows: Row[],
  keys: string[],
  normalizeMode: KeyNormalizeMode,
  compareColumns: string[],
  rows: ReconcileRow[],
  opts: HashPhaseOptions
): PhaseResult {
  const leftByKey = new Map<string, Row[]>();
  const rightByKey = new Map<string, Row[]>();
  const leftUnmatched: Row[] = [];
  const rightUnmatched: Row[] = [];

  for (const row of leftRows) {
    const k = rowKey(row, keys, normalizeMode);
    if (isBlankKey(k)) {
      leftUnmatched.push(row);
      continue;
    }
    const list = leftByKey.get(k) || [];
    list.push(row);
    leftByKey.set(k, list);
  }
  for (const row of rightRows) {
    const k = rowKey(row, keys, normalizeMode);
    if (isBlankKey(k)) {
      rightUnmatched.push(row);
      continue;
    }
    const list = rightByKey.get(k) || [];
    list.push(row);
    rightByKey.set(k, list);
  }

  const allKeys: string[] = [];
  leftByKey.forEach((_rows, k) => {
    allKeys.push(k);
  });
  rightByKey.forEach((_rows, k) => {
    if (allKeys.indexOf(k) < 0) allKeys.push(k);
  });
  allKeys.sort();

  for (const k of allKeys) {
    const L = (leftByKey.get(k) || []).slice();
    const R = (rightByKey.get(k) || []).slice();
    const usedR: boolean[] = R.map(() => false);
    const unmatchedL: Row[] = [];
    for (let i = 0; i < L.length; i++) {
      let hit = -1;
      for (let j = 0; j < R.length; j++) {
        if (usedR[j]) continue;
        if (compareRow(L[i], R[j], compareColumns).length === 0) {
          hit = j;
          break;
        }
      }
      if (hit >= 0) {
        usedR[hit] = true;
        rows.push({
          status: "matched",
          key: k,
          left: L[i],
          right: R[hit],
          matchMode: "exact",
          score: 1,
          review: "auto",
        });
      } else {
        unmatchedL.push(L[i]);
      }
    }
    const unmatchedR = R.filter((_row, j) => !usedR[j]);
    const n = Math.min(unmatchedL.length, unmatchedR.length);
    for (let i = 0; i < n; i++) {
      const conflicts = compareRow(unmatchedL[i], unmatchedR[i], compareColumns);
      rows.push({
        status: conflicts.length ? "conflict" : "matched",
        key: k,
        left: unmatchedL[i],
        right: unmatchedR[i],
        conflictColumns: conflicts.length ? conflicts : undefined,
        matchMode: conflicts.length ? "conflict" : "exact",
        score: conflicts.length ? 0 : 1,
        review: conflicts.length ? "需复核" : "auto",
      });
    }
    if (opts.emitRemainder) {
      for (let i = n; i < unmatchedL.length; i++) {
        rows.push({
          status: "left_only",
          key: k,
          left: unmatchedL[i],
          right: null,
          matchMode: "left_only",
          score: 0,
          review: "auto",
        });
      }
      for (let i = n; i < unmatchedR.length; i++) {
        rows.push({
          status: "right_only",
          key: k,
          left: null,
          right: unmatchedR[i],
          matchMode: "right_only",
          score: 0,
          review: "auto",
        });
      }
    } else {
      for (let i = n; i < unmatchedL.length; i++) leftUnmatched.push(unmatchedL[i]);
      for (let i = n; i < unmatchedR.length; i++) rightUnmatched.push(unmatchedR[i]);
    }
  }

  return { left: leftUnmatched, right: rightUnmatched };
}

interface DateCandidate {
  row: Row;
  key: string;
  date: number;
}

/**
 * Stage C — date-window pairing for rows still unmatched after A/B.
 * Groups by non-date key parts (normalized); within a group pairs by minimal
 * date difference inside ±N days; equal min diff → conflict (never a silent pick).
 */
function dateWindowPhase(
  leftRows: Row[],
  rightRows: Row[],
  keys: string[],
  normalizeMode: KeyNormalizeMode,
  compareColumns: string[],
  leftDateKey: string,
  rightDateKey: string,
  windowDays: number,
  rows: ReconcileRow[]
): PhaseResult {
  const leftByGroup = new Map<string, DateCandidate[]>();
  const rightByGroup = new Map<string, DateCandidate[]>();
  const leftUnmatched: Row[] = [];
  const rightUnmatched: Row[] = [];

  for (const row of leftRows) {
    const date = dateToDay(row[leftDateKey] ?? null);
    const group = keys
      .filter((k) => k !== leftDateKey)
      .map((k) => normalizeKeyPart(row[k] ?? null, normalizeMode))
      .join("\x1f");
    if (date === null || isBlankKey(group)) {
      leftUnmatched.push(row);
      continue;
    }
    const list = leftByGroup.get(group) || [];
    list.push({ row: row, key: rowKey(row, keys, normalizeMode), date: date });
    leftByGroup.set(group, list);
  }
  for (const row of rightRows) {
    const date = dateToDay(row[rightDateKey] ?? null);
    const group = keys
      .filter((k) => k !== rightDateKey)
      .map((k) => normalizeKeyPart(row[k] ?? null, normalizeMode))
      .join("\x1f");
    if (date === null || isBlankKey(group)) {
      rightUnmatched.push(row);
      continue;
    }
    const list = rightByGroup.get(group) || [];
    list.push({ row: row, key: rowKey(row, keys, normalizeMode), date: date });
    rightByGroup.set(group, list);
  }

  const allGroups: string[] = [];
  leftByGroup.forEach((_list, g) => {
    allGroups.push(g);
  });
  rightByGroup.forEach((_list, g) => {
    if (allGroups.indexOf(g) < 0) allGroups.push(g);
  });
  allGroups.sort();

  const usedRight = new Set<Row>();
  for (const g of allGroups) {
    const L = leftByGroup.get(g) || [];
    const R = rightByGroup.get(g) || [];
    for (const l of L) {
      let best: DateCandidate | null = null;
      let bestDiff = 0;
      let tie = false;
      for (const r of R) {
        if (usedRight.has(r.row)) continue;
        const diff = Math.abs(l.date - r.date);
        if (diff > windowDays) continue;
        if (best === null || diff < bestDiff) {
          best = r;
          bestDiff = diff;
          tie = false;
        } else if (diff === bestDiff) {
          tie = true;
        }
      }
      if (best === null) {
        leftUnmatched.push(l.row);
        continue;
      }
      usedRight.add(best.row);
      const conflicts = compareRow(l.row, best.row, compareColumns);
      if (tie) {
        rows.push({
          status: "conflict",
          key: l.key,
          left: l.row,
          right: best.row,
          conflictColumns: conflicts.length ? conflicts : undefined,
          matchMode: "conflict",
          score: 0,
          review: "需复核",
        });
      } else {
        const score = 1 - bestDiff / (windowDays + 1);
        rows.push({
          status: conflicts.length ? "conflict" : "matched",
          key: l.key,
          left: l.row,
          right: best.row,
          conflictColumns: conflicts.length ? conflicts : undefined,
          matchMode: conflicts.length ? "conflict" : "date_window",
          score: conflicts.length ? 0 : score,
          review: "需复核",
        });
      }
    }
  }
  rightByGroup.forEach(function (list) {
    for (const c of list) {
      if (!usedRight.has(c.row)) rightUnmatched.push(c.row);
    }
  });
  return { left: leftUnmatched, right: rightUnmatched };
}

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { leftHeaders, rightHeaders, keys } = input;
  for (const k of keys) {
    if (!leftHeaders.includes(k) || !rightHeaders.includes(k)) {
      throw new Error(`Key column "${k}" missing from one of the tables`);
    }
  }

  const matchMode = input.matchMode ?? "exact";
  const keyNormalize = input.keyNormalize ?? "trim";
  const dateWindowDays = input.dateWindowDays ?? 0;
  const auditColumns = input.auditColumns ?? matchMode !== "exact";

  if (matchMode === "date_window") {
    if (!(dateWindowDays > 0)) {
      throw new Error("date_window 需要 dateWindowDays > 0");
    }
    if (!input.leftDateKey || !input.rightDateKey) {
      throw new Error("date_window 需要 leftDateKey 与 rightDateKey");
    }
    if (!keys.includes(input.leftDateKey) || !leftHeaders.includes(input.leftDateKey)) {
      throw new Error(`Key column "${input.leftDateKey}" missing from one of the tables`);
    }
    if (!keys.includes(input.rightDateKey) || !rightHeaders.includes(input.rightDateKey)) {
      throw new Error(`Key column "${input.rightDateKey}" missing from one of the tables`);
    }
  }

  const compareColumns =
    input.compareColumns ??
    leftHeaders.filter((h) => rightHeaders.includes(h) && !keys.includes(h));

  const leftObjs = rowsToObjects(leftHeaders, input.leftRows);
  const rightObjs = rowsToObjects(rightHeaders, input.rightRows);

  const blankLeft: Row[] = [];
  const blankRight: Row[] = [];
  const pendingLeft: Row[] = [];
  const pendingRight: Row[] = [];
  for (const row of leftObjs) {
    if (isBlankKey(rowKey(row, keys))) blankLeft.push(row);
    else pendingLeft.push(row);
  }
  for (const row of rightObjs) {
    if (isBlankKey(rowKey(row, keys))) blankRight.push(row);
    else pendingRight.push(row);
  }

  const rows: ReconcileRow[] = [];

  // Stage A — exact (trim) hash pairing; always runs. For plain exact mode the
  // remainder is emitted inline so the output order matches the previous release.
  let phase = hashPairPhase(pendingLeft, pendingRight, keys, "trim", compareColumns, rows, {
    emitRemainder: matchMode === "exact",
  });
  let unmatchedLeft = phase.left;
  let unmatchedRight = phase.right;

  // Stage B — normalized-key hash pairing; only normalize / date_window and only
  // when the requested normalization differs from the default trim.
  if ((matchMode === "normalize" || matchMode === "date_window") && keyNormalize !== "trim") {
    phase = hashPairPhase(unmatchedLeft, unmatchedRight, keys, keyNormalize, compareColumns, rows, {
      emitRemainder: matchMode === "normalize",
    });
    unmatchedLeft = phase.left;
    unmatchedRight = phase.right;
  }

  // Stage C — date window; only date_window.
  if (matchMode === "date_window" && dateWindowDays > 0) {
    phase = dateWindowPhase(
      unmatchedLeft,
      unmatchedRight,
      keys,
      keyNormalize,
      compareColumns,
      input.leftDateKey!,
      input.rightDateKey!,
      dateWindowDays,
      rows
    );
    unmatchedLeft = phase.left;
    unmatchedRight = phase.right;
  }

  for (const row of unmatchedLeft) {
    rows.push({
      status: "left_only",
      key: rowKey(row, keys, keyNormalize),
      left: row,
      right: null,
      matchMode: "left_only",
      score: 0,
      review: "auto",
    });
  }
  for (const row of unmatchedRight) {
    rows.push({
      status: "right_only",
      key: rowKey(row, keys, keyNormalize),
      left: null,
      right: row,
      matchMode: "right_only",
      score: 0,
      review: "auto",
    });
  }

  for (const row of blankLeft) {
    rows.push({
      status: "left_only",
      key: "",
      left: row,
      right: null,
      matchMode: "left_only",
      score: 0,
      review: "auto",
    });
  }
  for (const row of blankRight) {
    rows.push({
      status: "right_only",
      key: "",
      left: null,
      right: row,
      matchMode: "right_only",
      score: 0,
      review: "auto",
    });
  }

  const counts: Record<ReconcileStatus, number> = {
    matched: 0,
    left_only: 0,
    right_only: 0,
    conflict: 0,
  };
  for (const r of rows) counts[r.status] += 1;

  let reviewPending = 0;
  for (const r of rows) {
    if (r.review === "需复核") reviewPending += 1;
  }

  const leftOut = leftHeaders.map((h) => `left_${h}`);
  const rightOut = rightHeaders.map((h) => `right_${h}`);
  const outputHeaders = ["status", "key", ...leftOut, ...rightOut, "conflict_columns"];
  if (auditColumns) outputHeaders.push("__match_mode", "__match_score", "__review");
  const outputRows: Cell[][] = [
    outputHeaders,
    ...rows.map((r) => {
      const base: Cell[] = [
        r.status,
        r.key,
        ...leftHeaders.map((h) => (r.left ? r.left[h] ?? null : null)),
        ...rightHeaders.map((h) => (r.right ? r.right[h] ?? null : null)),
        r.conflictColumns ? r.conflictColumns.join(",") : "",
      ];
      if (auditColumns) base.push(r.matchMode ?? "", r.score ?? "", r.review ?? "");
      return base;
    }),
  ];

  return { rows, counts, reviewPending, outputHeaders, outputRows };
}
