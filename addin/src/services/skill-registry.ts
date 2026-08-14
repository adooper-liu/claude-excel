/**
 * Skill executor registry for the Excel add-in.
 * Every tool in addin/skills/core/<name>/manifest.json must appear here.
 * Adding a manifest tool without a matching executeHandler case will fail tests
 * and throw when the taskpane loads.
 */

export const HANDLED_TOOLS: ReadonlySet<string> = new Set([
  "read_selection",
  "read_range",
  "write_to_sheet",
  "write_to_range",
  "get_sheet_names",
  "write_formula",
  "format_range",
  "conditional_format",
  "create_chart",
  "sort_filter",
  "set_active_sheet",
  "inspect_workbook",
  "inspect_table",
  "ensure_table",
  "reconcile_tables",
  "reshape_table",
  "calculate_table",
  "web_fetch",
]);

export function missingExecutors(toolNames: string[]): string[] {
  return Array.from(new Set(toolNames.filter((n) => !HANDLED_TOOLS.has(n)))).sort();
}

export function assertManifestExecutors(toolNames: string[]): void {
  const missing = missingExecutors(toolNames);
  if (missing.length > 0) {
    throw new Error(
      "Skill manifest has tools without executor (startup aborted): " + missing.join(", ")
    );
  }
}
