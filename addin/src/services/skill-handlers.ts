import * as Excel from '../excel';
import { selectionToMarkdown } from './context';
import type { ToolCall } from './claude';
import { HANDLED_TOOLS } from './skill-registry';

export interface HandlerContext {
  excel: typeof Excel;
  showMessage: (text: string) => void;
}

export async function executeHandler(tool: ToolCall, ctx: HandlerContext): Promise<string> {
  const { input } = tool;
  const E = ctx.excel;
  try {
    if (!HANDLED_TOOLS.has(tool.name)) {
      return `Unknown tool: ${tool.name}`;
    }
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
        const n = String(input.sheetName || '').trim();
        if (!n) return 'Error: sheetName required, e.g. 订单 or 流水.';
        if (/对账|reconcile|去重|反透视|拆列|reshape|查找结果|汇总结果|公式修复|XLOOKUP|SUMIFS/i.test(n)) {
          return 'write_to_sheet blocked: 对账用 reconcile_tables，整形用 reshape_table，公式用 calculate_table。先 ensure_table。';
        }
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
      case 'inspect_workbook': {
        return JSON.stringify(await E.inspectWorkbook());
      }
      case 'inspect_table': {
        return JSON.stringify(await E.inspectTable(input.tableName as string));
      }
      case 'ensure_table': {
        const r = await E.ensureTable(
          input.sheetName as string,
          input.range as string | undefined,
          input.tableName as string | undefined,
        );
        return JSON.stringify(r) + ' — use this exact name in reconcile_tables, reshape_table, or calculate_table.';
      }
      case 'reconcile_tables': {
        const keys = Array.isArray(input.keys)
          ? (input.keys as string[])
          : String(input.keys || '').split(',').map((s) => s.trim()).filter(Boolean);
        if (keys.length === 0) return 'Error: keys required';
        const compare = Array.isArray(input.compareColumns)
          ? (input.compareColumns as string[])
          : undefined;
        const r = await E.reconcileTables({
          leftTable: input.leftTable as string,
          rightTable: input.rightTable as string,
          keys,
          compareColumns: compare,
          outputSheet: input.outputSheet as string | undefined,
        });
        return JSON.stringify(r);
      }
      case 'reshape_table': {
        const splitCsv = (v: unknown): string[] | undefined => {
          if (Array.isArray(v)) return (v as string[]).map((s) => String(s).trim()).filter(Boolean);
          if (v == null || v === '') return undefined;
          return String(v).split(',').map((s) => s.trim()).filter(Boolean);
        };
        const op = String(input.op || '').trim();
        if (!op) return 'Error: op required (dedupe|unpivot|split|coerce)';
        const r = await E.reshapeTable({
          tableName: input.tableName as string,
          op: op as 'dedupe' | 'unpivot' | 'split' | 'coerce',
          keys: splitCsv(input.keys),
          idColumns: splitCsv(input.idColumns),
          valueColumns: splitCsv(input.valueColumns),
          attributeName: input.attributeName as string | undefined,
          valueName: input.valueName as string | undefined,
          column: input.column as string | undefined,
          separator: input.separator as string | undefined,
          maxParts: typeof input.maxParts === 'number' ? input.maxParts : undefined,
          type: input.type as 'number' | 'text' | 'date' | undefined,
          outputSheet: input.outputSheet as string | undefined,
        });
        return JSON.stringify(r);
      }
      case 'calculate_table': {
        const splitCsv = (v: unknown): string[] | undefined => {
          if (Array.isArray(v)) return (v as string[]).map((s) => String(s).trim()).filter(Boolean);
          if (v == null || v === '') return undefined;
          return String(v).split(',').map((s) => s.trim()).filter(Boolean);
        };
        const op = String(input.op || '').trim();
        if (!op) return 'Error: op required (lookup|sumifs|fix_ref)';
        const r = await E.calculateTable({
          op: op as 'lookup' | 'sumifs' | 'fix_ref',
          tableName: input.tableName as string | undefined,
          leftTable: input.leftTable as string | undefined,
          rightTable: input.rightTable as string | undefined,
          key: input.key as string | undefined,
          bringColumns: splitCsv(input.bringColumns),
          groupBy: input.groupBy as string | undefined,
          valueColumn: input.valueColumn as string | undefined,
          sheetName: input.sheetName as string | undefined,
          outputSheet: input.outputSheet as string | undefined,
        });
        return JSON.stringify(r);
      }
      case 'web_fetch': {
        const url = String(input.url || '').trim();
        if (!url) return JSON.stringify({ error: 'url required' });
        const r = await fetch('https://localhost:8765/api/web-fetch', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url }),
        });
        const body = await r.text();
        return body || JSON.stringify({ error: 'empty web-fetch response' });
      }
      default: return `Unknown tool: ${tool.name}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (tool.name === "ensure_table" || tool.name === "reconcile_tables" || tool.name === "reshape_table" || tool.name === "calculate_table") {
      return `${tool.name} failed: ${msg}. This tool IS available — fix the arguments and retry. Do not use write_to_sheet.`;
    }
    return `Error: ${msg}`;
  }
}
