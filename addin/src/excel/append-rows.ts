/** Drop incoming header when it matches the sheet header (follow-the-user append). */
export function rowsToAppend(
  header: (string | number)[] | undefined,
  incoming: (string | number)[][]
): (string | number)[][] {
  if (!incoming.length) return [];
  if (!header || !header.length) return incoming;
  const left = header.map((c) => String(c).trim()).join("\0");
  const right = (incoming[0] || []).map((c) => String(c).trim()).join("\0");
  return left === right ? incoming.slice(1) : incoming;
}
