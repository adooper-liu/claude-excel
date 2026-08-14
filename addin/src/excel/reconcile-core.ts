/** Pure reconcile logic — no Office JS. Exact match only; blank keys never match. */

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;
export type ReconcileStatus = "matched" | "left_only" | "right_only" | "conflict";

export interface ReconcileInput {
  leftHeaders: string[];
  leftRows: Cell[][];
  rightHeaders: string[];
  rightRows: Cell[][];
  keys: string[];
  compareColumns?: string[];
}

export interface ReconcileRow {
  status: ReconcileStatus;
  key: string;
  left: Row | null;
  right: Row | null;
  conflictColumns?: string[];
}

export interface ReconcileResult {
  rows: ReconcileRow[];
  counts: Record<ReconcileStatus, number>;
  outputHeaders: string[];
  outputRows: Cell[][];
}

export function normalizeKeyPart(value: Cell): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
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

export function rowKey(row: Row, keys: string[]): string {
  return keys.map((k) => normalizeKeyPart(row[k] ?? null)).join("\x1f");
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

export function reconcile(input: ReconcileInput): ReconcileResult {
  const { leftHeaders, rightHeaders, keys } = input;
  for (const k of keys) {
    if (!leftHeaders.includes(k) || !rightHeaders.includes(k)) {
      throw new Error(`Key column "${k}" missing from one of the tables`);
    }
  }

  const compareColumns =
    input.compareColumns ??
    leftHeaders.filter((h) => rightHeaders.includes(h) && !keys.includes(h));

  const leftObjs = rowsToObjects(leftHeaders, input.leftRows);
  const rightObjs = rowsToObjects(rightHeaders, input.rightRows);

  const leftByKey = new Map<string, Row[]>();
  const rightByKey = new Map<string, Row[]>();
  const blankLeft: Row[] = [];
  const blankRight: Row[] = [];

  for (const row of leftObjs) {
    const k = rowKey(row, keys);
    if (isBlankKey(k)) blankLeft.push(row);
    else {
      const list = leftByKey.get(k) || [];
      list.push(row);
      leftByKey.set(k, list);
    }
  }
  for (const row of rightObjs) {
    const k = rowKey(row, keys);
    if (isBlankKey(k)) blankRight.push(row);
    else {
      const list = rightByKey.get(k) || [];
      list.push(row);
      rightByKey.set(k, list);
    }
  }

  const allKeys: string[] = [];
  leftByKey.forEach((_rows, k) => {
    allKeys.push(k);
  });
  rightByKey.forEach((_rows, k) => {
    if (allKeys.indexOf(k) < 0) allKeys.push(k);
  });
  allKeys.sort();

  const rows: ReconcileRow[] = [];

  for (const k of allKeys) {
    const L = leftByKey.get(k) || [];
    const R = rightByKey.get(k) || [];
    const n = Math.min(L.length, R.length);
    for (let i = 0; i < n; i++) {
      const conflicts = compareRow(L[i], R[i], compareColumns);
      rows.push({
        status: conflicts.length ? "conflict" : "matched",
        key: k,
        left: L[i],
        right: R[i],
        conflictColumns: conflicts.length ? conflicts : undefined,
      });
    }
    for (let i = n; i < L.length; i++) {
      rows.push({ status: "left_only", key: k, left: L[i], right: null });
    }
    for (let i = n; i < R.length; i++) {
      rows.push({ status: "right_only", key: k, left: null, right: R[i] });
    }
  }

  for (const row of blankLeft) {
    rows.push({ status: "left_only", key: "", left: row, right: null });
  }
  for (const row of blankRight) {
    rows.push({ status: "right_only", key: "", left: null, right: row });
  }

  const counts: Record<ReconcileStatus, number> = {
    matched: 0,
    left_only: 0,
    right_only: 0,
    conflict: 0,
  };
  for (const r of rows) counts[r.status] += 1;

  const leftOut = leftHeaders.map((h) => `left_${h}`);
  const rightOut = rightHeaders.map((h) => `right_${h}`);
  const outputHeaders = ["status", "key", ...leftOut, ...rightOut, "conflict_columns"];
  const outputRows: Cell[][] = [
    outputHeaders,
    ...rows.map((r) => [
      r.status,
      r.key,
      ...leftHeaders.map((h) => (r.left ? r.left[h] ?? null : null)),
      ...rightHeaders.map((h) => (r.right ? r.right[h] ?? null : null)),
      r.conflictColumns ? r.conflictColumns.join(",") : "",
    ]),
  ];

  return { rows, counts, outputHeaders, outputRows };
}
