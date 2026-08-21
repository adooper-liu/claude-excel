/// <reference types="@types/office-js" />

const AUDIT_SHEET = "_pack_audit";

export type PackAuditEntry = {
  packId: string;
  packVersion?: string;
  runType: string;
  matched?: number;
  leftOnly?: number;
  rightOnly?: number;
  conflict?: number;
  reviewPending?: number;
  sourceHashOrders?: string;
  sourceHashAds?: string;
  note?: string;
  /** JSON string of assumption cells at run time (e.g. {"B2":7.2,"B4":0.08}). */
  assumptionSnapshot?: string;
  /** matched / (matched+left_only+right_only+conflict); 0–1. */
  matchRate?: number;
};

/** Header row for `_pack_audit`. New columns append at end for backward compatibility. */
export function auditHeaders(): string[] {
  return [
    "timestamp",
    "packId",
    "packVersion",
    "runType",
    "matched",
    "left_only",
    "right_only",
    "conflict",
    "review_pending",
    "sourceHash_orders",
    "sourceHash_ads",
    "note",
    "assumption_snapshot",
    "match_rate",
  ];
}

/** Pure row builder (unit-testable). Timestamp injected for determinism in tests. */
export function entryToRow(entry: PackAuditEntry, timestampIso?: string): (string | number)[] {
  const ts = timestampIso || new Date().toISOString();
  const rate =
    entry.matchRate == null || Number.isNaN(Number(entry.matchRate))
      ? ""
      : Number(entry.matchRate);
  return [
    ts,
    entry.packId || "",
    entry.packVersion || "",
    entry.runType || "",
    entry.matched ?? "",
    entry.leftOnly ?? "",
    entry.rightOnly ?? "",
    entry.conflict ?? "",
    entry.reviewPending ?? "",
    entry.sourceHashOrders ?? "",
    entry.sourceHashAds ?? "",
    entry.note ?? "",
    entry.assumptionSnapshot ?? "",
    rate,
  ];
}

/** Append one audit row to `_pack_audit` (creates sheet + header if missing). */
export async function appendPackAudit(entry: PackAuditEntry): Promise<{ sheet: string; row: number }> {
  if (!String(entry.packId || "").trim()) {
    throw new Error("append_pack_audit 需要 packId");
  }
  if (!String(entry.runType || "").trim()) {
    throw new Error("append_pack_audit 需要 runType");
  }
  const row = entryToRow(entry);
  let writtenAt = 0;
  await Excel.run(async (context) => {
    const sheets = context.workbook.worksheets;
    sheets.load("items/name");
    await context.sync();
    const names = sheets.items.map((s) => s.name);
    let sheet: Excel.Worksheet;
    if (names.indexOf(AUDIT_SHEET) < 0) {
      sheet = sheets.add(AUDIT_SHEET);
      const header = auditHeaders();
      sheet.getRangeByIndexes(0, 0, 1, header.length).values = [header];
      sheet.getRangeByIndexes(0, 0, 1, header.length).format.font.bold = true;
    } else {
      sheet = sheets.getItem(AUDIT_SHEET);
    }
    const used = sheet.getUsedRangeOrNullObject();
    used.load("rowCount");
    await context.sync();
    const nextRow = used.isNullObject ? 1 : used.rowCount;
    sheet.getRangeByIndexes(nextRow, 0, 1, row.length).values = [row];
    writtenAt = nextRow + 1; // 1-based Excel row for humans
    await context.sync();
  });
  return { sheet: AUDIT_SHEET, row: writtenAt };
}
