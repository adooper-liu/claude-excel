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
  sourceHashOrders?: string;
  sourceHashAds?: string;
  note?: string;
};

function auditHeaders(): string[] {
  return [
    "timestamp",
    "packId",
    "packVersion",
    "runType",
    "matched",
    "left_only",
    "right_only",
    "conflict",
    "sourceHash_orders",
    "sourceHash_ads",
    "note",
  ];
}

function entryToRow(entry: PackAuditEntry): (string | number)[] {
  const ts = new Date().toISOString();
  return [
    ts,
    entry.packId || "",
    entry.packVersion || "",
    entry.runType || "",
    entry.matched ?? "",
    entry.leftOnly ?? "",
    entry.rightOnly ?? "",
    entry.conflict ?? "",
    entry.sourceHashOrders ?? "",
    entry.sourceHashAds ?? "",
    entry.note ?? "",
  ];
}

/** Append one audit row to `_pack_audit` (creates sheet + header if missing). */
export async function appendPackAudit(entry: PackAuditEntry): Promise<void> {
  const row = entryToRow(entry);
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
    await context.sync();
  });
}
