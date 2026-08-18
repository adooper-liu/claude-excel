/**
 * Skill executor registry for the Excel add-in.
 * Every tool in addin/skills/core/<name>/manifest.json must appear here.
 * Adding a manifest tool without a matching executeHandler case will fail tests
 * and throw when the taskpane loads.
 */

export const HANDLED_TOOLS: ReadonlySet<string> = new Set([
  "read_selection",
  "read_range",
  "extract_selection",
  "write_to_sheet",
  "write_to_range",
  "get_sheet_names",
  "write_formula",
  "format_range",
  "conditional_format",
  "data_validation",
  "create_chart",
  "sort_filter",
  "fill_range",
  "find_replace",
  "set_active_sheet",
  "inspect_workbook",
  "inspect_table",
  "inspect_formulas",
  "scan_formula_errors",
  "ensure_table",
  "reconcile_tables",
  "reshape_table",
  "calculate_table",
  "create_pivot",
  "write_inputs",
  "web_fetch",
  "search_knowledge",
  "run_flow",
  "complete",
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
