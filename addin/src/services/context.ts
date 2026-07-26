/**
 * context.ts — Build Claude-ready prompts from Excel data.
 *
 * Handles:
 *  - Selection → Markdown table formatting
 *  - Large dataset detection and sampling
 *  - Prompt construction with Excel context
 */

const MAX_CELLS_FULL = 500;
const MAX_CELLS_SAMPLE = 5000;

export interface SelectionContext {
  /** Markdown representation of the data */
  markdown: string;
  /** Human-readable summary */
  summary: string;
  /** Whether the data was truncated */
  truncated: boolean;
  /** Original row × col count */
  dimensions: { rows: number; cols: number };
}

/**
 * Convert a 2D array (from Excel) to a Markdown table.
 * Handles large selections by truncating.
 */
export function selectionToMarkdown(values: string[][], address: string): SelectionContext {
  if (!values || values.length === 0) {
    return {
      markdown: '(empty selection)',
      summary: 'No data selected.',
      truncated: false,
      dimensions: { rows: 0, cols: 0 },
    };
  }

  const totalRows = values.length;
  const totalCols = values[0]?.length || 0;
  const totalCells = totalRows * totalCols;

  let rows = values;
  let truncated = false;

  if (totalCells > MAX_CELLS_SAMPLE) {
    // Severely truncated — just summarize
    rows = values.slice(0, 3);
    truncated = true;
    return {
      markdown: buildTable(rows) + `\n\n*(Showing first 3 of ${totalRows} rows — ${totalRows} × ${totalCols} cells total. Please narrow your selection.)*`,
      summary: `Large selection: ${totalRows} rows × ${totalCols} cols (${address}). Too large to include fully. Select a smaller range or use "One-Click Analyze".`,
      truncated: true,
      dimensions: { rows: totalRows, cols: totalCols },
    };
  }

  if (totalCells > MAX_CELLS_FULL) {
    // Sample: first 500 cells worth of rows
    const maxRows = Math.floor(MAX_CELLS_FULL / totalCols);
    rows = values.slice(0, maxRows);
    truncated = true;
    return {
      markdown: buildTable(rows) + `\n\n*(Showing first ${maxRows} of ${totalRows} rows — ${totalRows} × ${totalCols} total)*`,
      summary: `${totalRows} rows × ${totalCols} cols (${address}). Showing first ${maxRows} rows.`,
      truncated: true,
      dimensions: { rows: totalRows, cols: totalCols },
    };
  }

  return {
    markdown: buildTable(rows),
    summary: `${totalRows} rows × ${totalCols} cols (${address})`,
    truncated: false,
    dimensions: { rows: totalRows, cols: totalCols },
  };
}

function buildTable(values: string[][]): string {
  if (values.length === 0) return '';

  const header = values[0];
  const data = values.slice(1);

  // Build markdown table — Row 1=header, Row 2+=data (matches Excel row numbers)
  const lines: string[] = [];
  lines.push('| Row | ' + header.map(c => escapeCell(String(c ?? ''))).join(' | ') + ' |');
  lines.push('| --- | ' + header.map(() => '---').join(' | ') + ' |');
  lines.push('| 1 | ' + header.map(c => escapeCell(String(c ?? ''))).join(' | ') + ' |');
  for (let i = 0; i < data.length; i++) {
    lines.push('| ' + (i + 2) + ' | ' + data[i].map(c => escapeCell(String(c ?? ''))).join(' | ') + ' |');
  }
  return lines.join('\n');
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Build a system prompt for Excel AI assistant.
 */
export function buildSystemPrompt(): string {
  return `You are an Excel AI assistant powered by Claude. You help users analyze,
clean, and understand spreadsheet data.

Guidelines:
- Respond in the user's language (Chinese or English, match the user).
- When presenting analysis, use clear section headings.
- When suggesting Excel operations, mention specific cell ranges and formulas.
- For data analysis: highlight key findings first, then details.
- For data cleaning: list what changed, what remains, and what needs manual review.
- When asked to write to Excel, format output as a plain table. The user can click "Write to Sheet" to insert it.
- Be concise but thorough. Skip filler phrases.`;
}

/**
 * Build a user prompt that includes Excel data context.
 */
export function buildUserPrompt(
  userMessage: string,
  selection: SelectionContext,
): string {
  const parts: string[] = [];

  if (selection.dimensions.rows > 0) {
    parts.push(`## Selected Data (${selection.summary})`);
    parts.push('');
    parts.push(selection.markdown);
  }

  parts.push('');
  parts.push('## User Request');
  parts.push(userMessage);

  return parts.join('\n');
}

/**
 * Build a one-click analysis prompt.
 */
export function buildAnalysisPrompt(selection: SelectionContext): string {
  return buildUserPrompt(
    'Please analyze this data. Provide:\n'
      + '1. **Overview**: what is this data about?\n'
      + '2. **Key statistics**: column summaries (count, mean, median for numeric columns)\n'
      + '3. **Notable patterns**: trends, outliers, or interesting distributions\n'
      + '4. **Issues found**: missing values, potential errors, formatting problems\n'
      + '5. **Suggestions**: what analysis or cleaning could be done next?\n\n'
      + 'Format the output as a clear report with section headings.',
    selection,
  );
}

/**
 * Build a one-click cleaning prompt.
 */
export function buildCleaningPrompt(selection: SelectionContext): string {
  return buildUserPrompt(
    'Clean this data by identifying:\n'
      + '1. **Whitespace issues**: cells with leading/trailing spaces\n'
      + '2. **Duplicate rows**: mark any duplicates found\n'
      + '3. **Inconsistent formatting**: dates, numbers, text casing\n'
      + '4. **Missing values**: columns with gaps and suggested fill strategies\n'
      + '5. **Suggested fixes**: for each issue, suggest the Excel formula or operation to fix it\n\n'
      + 'Present findings in a table: | Issue Type | Column | Row | Current Value | Suggested Fix |',
    selection,
  );
}
