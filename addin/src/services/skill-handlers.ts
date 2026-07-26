import * as Excel from '../excel';
import { selectionToMarkdown } from './context';
import type { ToolCall } from './claude';

export interface HandlerContext {
  excel: typeof Excel;
  showMessage: (text: string) => void;
}

export async function executeHandler(tool: ToolCall, ctx: HandlerContext): Promise<string> {
  const { input } = tool;
  const E = ctx.excel;
  try {
    switch (tool.name) {
      case 'read_selection': {
        const sel = await E.readSelection();
        const md = selectionToMarkdown(sel.values, sel.address);
        return JSON.stringify({ address: sel.address, rows: sel.rowCount, cols: sel.colCount, markdown: md.markdown });
      }
      case 'read_range': {
        const values = await E.readRange(input.sheetName as string, input.range as string);
        const md = selectionToMarkdown(values, `${input.sheetName}!${input.range}`);
        const m = (input.range as string).match(/[A-Z]+(\d+)/);
        const sr = m ? parseInt(m[1]) : 1;
        return JSON.stringify({ sheet: input.sheetName, range: input.range, rows: values.length, cols: values[0]?.length || 0, startRow: sr, markdown: md.markdown });
      }
      case 'write_to_sheet': {
        const d = input.data as (string | number)[][];
        const n = (input.sheetName as string) || 'AI Result';
        await E.writeToNewSheet(n, d);
        return `Created "${n}" with ${d.length}×${d[0]?.length || 0}.`;
      }
      case 'write_to_range': {
        const v = input.values as (string | number)[][];
        await E.writeToRange(input.sheetName as string, input.range as string, v);
        return `Wrote to ${input.sheetName}!${input.range}.`;
      }
      case 'get_sheet_names': return JSON.stringify(await E.getSheetNames());
      case 'write_formula': {
        const f = input.formulas as (string | number)[][];
        await E.writeFormulas(input.sheetName as string, input.range as string, f);
        return `Formulas written to ${input.sheetName}!${input.range}.`;
      }
      case 'format_range': {
        const fmt: Record<string, unknown> = {};
        for (const k of ['bold','color','bgColor','numberFormat','fontSize','columnWidth'])
          if (input[k] !== undefined) fmt[k] = input[k];
        await E.formatRange(input.sheetName as string, input.range as string, fmt as Parameters<typeof E.formatRange>[2]);
        return `Formatted ${input.sheetName}!${input.range}.`;
      }
      case 'conditional_format': {
        const opts: Record<string, unknown> = {};
        for (const k of ['barColor','minColor','maxColor','iconStyle','operator','compareTo','fillColor','rank','top'])
          if (input[k] !== undefined) opts[k] = input[k];
        await E.addConditionalFormat(input.sheetName as string, input.range as string, input.type as string, opts);
        return `Applied ${input.type} to ${input.sheetName}!${input.range}.`;
      }
      case 'create_chart': {
        await E.createChart(input.sheetName as string, input.dataRange as string, input.chartType as string, input.title as string, input.seriesBy as string | undefined, input.labelRange as string | undefined);
        return `Created ${input.chartType} chart "${input.title}".`;
      }
      case 'sort_filter': {
        await E.applySortFilter(input.sheetName as string, input.range as string, input.action as 'sort'|'filter'|'clearFilter', input.sortBy as Parameters<typeof E.applySortFilter>[3], input.filterBy as Parameters<typeof E.applySortFilter>[4]);
        return `Applied ${input.action} to ${input.sheetName}!${input.range}.`;
      }
      case 'set_active_sheet': {
        await E.setActiveSheet(input.sheetName as string);
        return `Switched to "${input.sheetName}".`;
      }
      default: return `Unknown tool: ${tool.name}`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
