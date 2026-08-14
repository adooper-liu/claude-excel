export function extractMarkdownTable(raw: string): string | null {
  if (!raw) return null;
  let text = raw;
  try {
    const obj = JSON.parse(raw);
    if (obj && typeof obj.markdown === "string") text = obj.markdown;
  } catch {
    /* not JSON */
  }
  const m = text.match(/\|.+\|\r?\n\|[-| :]+\|\r?\n(?:\|.+\|\r?\n?)*/);
  return m ? m[0].trim() : null;
}

export function trimMarkdownTable(table: string, maxRows = 8): string {
  const lines = table.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length <= 2 + maxRows) return table;
  return lines.slice(0, 2 + maxRows).join("\n");
}
