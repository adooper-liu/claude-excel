/**
 * Excel ListObject names must start with [A-Za-z_].
 * CJK and other non-ASCII first characters throw on table.name assignment.
 */
export function sanitizeTableName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_\u4e00-\u9fff]/g, "_");
  if (!cleaned) return "Table";
  let out = cleaned;
  if (/^[0-9]/.test(out)) {
    out = "_" + out;
  } else if (!/^[A-Za-z_]/.test(out)) {
    out = "T_" + out;
  }
  return out.slice(0, 30);
}

/** Turn 'Sheet'!$A$1:$D$6 or A1:D6 into A1:D6 for worksheet.getRange. */
export function parseA1Range(range: string): string {
  const s = String(range || "").trim().replace(/\$/g, "");
  const bang = s.lastIndexOf("!");
  return bang >= 0 ? s.slice(bang + 1) : s;
}

/**
 * Map a caller-supplied table name to the real ListObject name.
 * Chinese names are stored as T_系统订单表; the model often retries the original.
 */
export function resolveTableName(requested: string, existing: string[]): string {
  const q = String(requested || "").trim();
  if (!q) {
    throw new Error("Table name is empty. Existing tables: " + (existing.join(", ") || "(none)"));
  }
  if (existing.indexOf(q) >= 0) return q;
  const sanitized = sanitizeTableName(q);
  if (existing.indexOf(sanitized) >= 0) return sanitized;
  const hits = existing.filter(function (n) {
    return n === sanitized || n.indexOf(q) >= 0 || n.endsWith(q);
  });
  if (hits.length === 1) return hits[0];
  throw new Error('Table "' + q + '" not found. Existing tables: ' + (existing.join(", ") || "(none)"));
}
