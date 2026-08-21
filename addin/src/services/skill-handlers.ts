import * as Excel from '../excel';
import { selectionToMarkdown } from './context';
import type { ToolCall } from './claude';
import { HANDLED_TOOLS } from './skill-registry';
import { parseFormatInput } from '../excel/format-core';

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
      case 'extract_selection': {
        const caseRaw = String(input.caseMode || 'title').trim().toLowerCase();
        const caseMode =
          caseRaw === 'lower' || caseRaw === 'upper' || caseRaw === 'keep' ? caseRaw : 'title';
        const r = await E.extractSelection({
          sheetName: input.sheetName as string | undefined,
          range: input.range as string | undefined,
          column: input.column as string | undefined,
          caseMode,
          unique: input.unique === true || String(input.unique) === "true",
          outputSheet: input.outputSheet as string | undefined,
        });
        return JSON.stringify(r);
      }
      case 'write_to_sheet': {
        const d = input.data as (string | number)[][];
        const n = String(input.sheetName || '').trim();
        if (!n) return 'Error: sheetName required, e.g. 订单 or 流水.';
        if (/对账|reconcile|去重|反透视|拆列|reshape|提取|_规范|拍平|格式结果|查找结果|汇总结果|公式修复|XLOOKUP|SUMIFS/i.test(n)) {
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
      case 'write_inputs': {
        const cells = Array.isArray(input.cells) ? input.cells as Array<{ address: string; value: string | number | boolean }> : [];
        const r = await E.writeInputs(input.sheetName as string, cells);
        return JSON.stringify(r);
      }
      case 'get_sheet_names': return JSON.stringify(await E.getSheetNames());
      case 'write_formula': {
        const f = input.formulas as (string | number)[][];
        await E.writeFormulas(input.sheetName as string, input.range as string, f);
        return `Formulas written to ${input.sheetName}!${input.range}.`;
      }
      case 'format_range': {
        const fmt = parseFormatInput(input as Record<string, unknown>);
        const r = await E.formatRange(input.sheetName as string, input.range as string, fmt);
        return JSON.stringify(r);
      }
      case 'conditional_format': {
        const opts: Record<string, unknown> = {};
        for (const k of ['barColor','minColor','maxColor','iconStyle','operator','compareTo','fillColor','rank','top'])
          if (input[k] !== undefined) opts[k] = input[k];
        await E.addConditionalFormat(input.sheetName as string, input.range as string, input.type as string, opts);
        return `Applied ${input.type} to ${input.sheetName}!${input.range}.`;
      }
      case 'create_chart': {
        await E.createChart(input.sheetName as string, input.dataRange as string, input.chartType as string, input.title as string, input.seriesBy as string | undefined, input.labelRange as string | undefined, input.palette as string | undefined);
        return `Created ${input.chartType} chart "${input.title}".`;
      }
      case 'create_pivot': {
        const splitCsv = (v: unknown): string[] | undefined => {
          if (Array.isArray(v)) return (v as string[]).map((s) => String(s).trim()).filter(Boolean);
          if (v == null || v === '') return undefined;
          return String(v).split(',').map((s) => s.trim()).filter(Boolean);
        };
        const rawValues = Array.isArray(input.values) ? input.values as Array<{ field?: string; aggregation?: string }> : [];
        const r = await E.createPivot({
          tableName: input.tableName as string | undefined,
          sourceSheet: input.sourceSheet as string | undefined,
          sourceRange: input.sourceRange as string | undefined,
          outputSheet: input.outputSheet as string | undefined,
          rows: splitCsv(input.rows),
          columns: splitCsv(input.columns),
          filters: splitCsv(input.filters),
          values: rawValues.map((v) => ({ field: String(v.field || ''), aggregation: v.aggregation })),
        });
        return JSON.stringify(r);
      }
      case 'sort_filter': {
        const r = await E.applySortFilter(
          input.sheetName as string,
          input.range as string,
          input.action as 'sort'|'filter'|'clearFilter',
          input.sortBy as Parameters<typeof E.applySortFilter>[3],
          input.filterBy as Parameters<typeof E.applySortFilter>[4]
        );
        return JSON.stringify(r);
      }
      case 'fill_range': {
        const r = await E.fillRange({
          sheetName: input.sheetName as string,
          range: input.range as string,
          destination: input.destination as string | undefined,
          direction: input.direction as string | undefined,
          fillType: input.fillType as string | undefined,
        });
        return JSON.stringify(r);
      }
      case 'find_replace': {
        const r = await E.findReplace({
          sheetName: input.sheetName as string,
          range: input.range as string | undefined,
          find: String(input.find ?? ''),
          replace: String(input.replace ?? ''),
          matchCase: input.matchCase === true,
          completeMatch: input.completeMatch === true,
          lookIn: input.lookIn === 'formulas' ? 'formulas' : 'values',
        });
        return JSON.stringify(r);
      }
      case 'data_validation': {
        const r = await E.applyDataValidation({
          sheetName: input.sheetName as string,
          range: input.range as string,
          type: String(input.type || ''),
          source: input.source as string | undefined,
          operator: input.operator as string | undefined,
          formula1: input.formula1 as string | undefined,
          formula2: input.formula2 as string | undefined,
          formula: input.formula as string | undefined,
          errorMessage: input.errorMessage as string | undefined,
          allowBlank: input.allowBlank as boolean | undefined,
        });
        return JSON.stringify(r);
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
      case 'inspect_formulas': {
        return JSON.stringify(await E.inspectFormulas({
          sheetName: input.sheetName as string | undefined,
          range: input.range as string | undefined,
          tableName: input.tableName as string | undefined,
        }));
      }
      case 'scan_formula_errors': {
        return JSON.stringify(await E.scanFormulaErrors({
          sheetName: input.sheetName as string | undefined,
        }));
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
        const matchMode =
          input.matchMode === 'normalize' || input.matchMode === 'date_window'
            ? input.matchMode
            : undefined;
        const keyNormalize =
          input.keyNormalize === 'trim_lower' || input.keyNormalize === 'trim_collapse_ws'
            ? input.keyNormalize
            : undefined;
        const dateWindowDays =
          typeof input.dateWindowDays === 'number' && input.dateWindowDays > 0
            ? input.dateWindowDays
            : undefined;
        const auditColumns =
          input.auditColumns === true ? true : input.auditColumns === false ? false : undefined;
        const compareTolerance =
          typeof input.compareTolerance === 'number' && input.compareTolerance > 0
            ? input.compareTolerance
            : undefined;
        const r = await E.reconcileTables({
          leftTable: input.leftTable as string,
          rightTable: input.rightTable as string,
          keys,
          compareColumns: compare,
          outputSheet: input.outputSheet as string | undefined,
          matchMode,
          keyNormalize,
          dateWindowDays,
          leftDateKey: input.leftDateKey as string | undefined,
          rightDateKey: input.rightDateKey as string | undefined,
          auditColumns,
          compareTolerance,
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
        if (!op) return 'Error: op required (dedupe|unpivot|split|coerce|coerce_columns|project|flatten_header)';
        const parseColumns = (v: unknown) => {
          if (Array.isArray(v)) return v;
          if (v == null || v === '') return undefined;
          try {
            const parsed = JSON.parse(String(v));
            return Array.isArray(parsed) ? parsed : undefined;
          } catch {
            return undefined;
          }
        };
        const parseColumnHints = (v: unknown) => {
          const raw = parseColumns(v) || parseColumns(input.formatHints);
          if (!raw) return undefined;
          return raw
            .map(function (item) {
              if (!item || typeof item !== 'object') return null;
              const o = item as Record<string, unknown>;
              const kind = String(o.kind || '').trim();
              if (!kind) return null;
              return {
                index: typeof o.index === 'number' ? o.index : parseInt(String(o.index ?? ''), 10),
                letter: String(o.letter || '').trim(),
                header: String(o.header || '').trim(),
                kind: kind,
                hint: String(o.hint || '').trim(),
                excelFormat: o.excelFormat ? String(o.excelFormat) : undefined,
              };
            })
            .filter(Boolean);
        };
        const columns = parseColumns(input.columns);
        const columnHints = parseColumnHints(input.columnHints);
        if (op === 'flatten_header') {
          if (!String(input.sheetName || '').trim() || !String(input.range || '').trim()) {
            return 'Error: op=flatten_header 需要 sheetName + range（含双层表头与数据）。不要用 read_range 代替。';
          }
        } else if (!String(input.tableName || '').trim()) {
          return 'Error: op=' + op + ' 需要 tableName（先 ensure_table）。flatten_header 改用 sheetName+range。';
        }
        if (op === 'project' && (!columns || !columns.length)) {
          return 'Error: op=project 需要 columns 数组（[{as, from} 或 {as, merge, coerce}]). 先 inspect_table 看 columns.index/letter；取数_* 表加 headerless:true。不要用 read_range 代替。';
        }
        const headerRows =
          typeof input.headerRows === 'number'
            ? input.headerRows
            : input.headerRows != null && input.headerRows !== ''
              ? parseInt(String(input.headerRows), 10)
              : undefined;
        const r = await E.reshapeTable({
          tableName: input.tableName as string | undefined,
          sheetName: input.sheetName as string | undefined,
          range: input.range as string | undefined,
          headerRows: Number.isFinite(headerRows) ? headerRows : undefined,
          op: op as 'dedupe' | 'unpivot' | 'split' | 'coerce' | 'coerce_columns' | 'project' | 'flatten_header',
          keys: splitCsv(input.keys),
          idColumns: splitCsv(input.idColumns),
          valueColumns: splitCsv(input.valueColumns),
          attributeName: input.attributeName as string | undefined,
          valueName: input.valueName as string | undefined,
          column: input.column as string | undefined,
          separator: input.separator as string | undefined,
          maxParts: typeof input.maxParts === 'number' ? input.maxParts : undefined,
          type: input.type as 'number' | 'text' | 'date' | undefined,
          headerless: Boolean(input.headerless),
          columns: columns,
          formatHints: columnHints as import('../excel/column-format-core').ColumnFormatHint[] | undefined,
          format: input.format === 'manual' ? 'manual' : 'auto',
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
      case 'search_knowledge': {
        const query = String(input.query || '').trim();
        if (!query) return JSON.stringify({ error: 'query required' });
        const payload: Record<string, unknown> = { query };
        if (input.topK != null) payload.topK = input.topK;
        if (input.docId != null) payload.docId = input.docId;
        const r = await fetch('https://localhost:8765/api/knowledge/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const body = await r.text();
        return body || JSON.stringify({ error: 'empty knowledge search response' });
      }
      case 'run_flow': {
        const flow = String(input.flow || '').trim();
        const text = String(input.text || '').trim();
        if (!text) return 'Error: run_flow 需要 text（用户原话），流程要从中解析键列/参数。';
        const flows: Record<string, (t: string, s?: (m: string) => void) => Promise<string>> = {
          reconcile: E.runReconcileIntent,
          extract: E.runExtractIntent,
          project: E.runProjectReshapeIntent,
          flatten_header: E.runFlattenHeaderIntent,
          reshape: E.runReshapeIntent,
          calculate: E.runCalculateIntent,
        };
        const run = flows[flow];
        if (!run) {
          return 'Error: run_flow 需要 flow ∈ reconcile|extract|project|flatten_header|reshape|calculate。业财走已装 Pack 的 /跨境业财（SKILL 编排），不走 run_flow。';
        }
        // 明示选中的流程，让选错可见（B 类错误 fail-visible）
        ctx.showMessage('🔧 run_flow(flow=' + flow + ') 用户原话：' + text.slice(0, 80));
        return await run(text, ctx.showMessage);
      }
      case 'complete': {
        // 正常由 chatWithTools 拦截；这里是兜底（若绕过循环直接调用）
        return String(input.result || 'done');
      }
      case 'save_structure_note': {
        const sheet = String(input.sheet || '').trim();
        if (!sheet) return 'Error: save_structure_note 需要 sheet。';
        const fileKey = await E.workbookFileKey();
        let r: Response;
        try {
          r = await fetch('https://localhost:8765/api/table-structure', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              fileKey: fileKey,
              sheet: sheet,
              schema: input.schema,
              inferences: input.inferences,
              advisories: input.advisories,
            }),
          });
        } catch (e) {
          return 'Error: save_structure_note 后端不可达：' + String(e);
        }
        const body = await r.text();
        if (!r.ok) return 'Error: save_structure_note 失败（HTTP ' + r.status + '）：' + body;
        return body;
      }
      case 'load_structure_notes': {
        const sheet = String(input.sheet || '').trim();
        if (!sheet) return 'Error: load_structure_notes 需要 sheet。';
        const fileKey = await E.workbookFileKey();
        let r: Response;
        try {
          r = await fetch(
            'https://localhost:8765/api/table-structure?fileKey=' +
              encodeURIComponent(fileKey) +
              '&sheet=' +
              encodeURIComponent(sheet)
          );
        } catch (e) {
          return 'Error: load_structure_notes 后端不可达：' + String(e);
        }
        const body = await r.text();
        if (!r.ok) return 'Error: load_structure_notes 失败（HTTP ' + r.status + '）：' + body;
        return body || '{}';
      }
      case 'append_pack_audit': {
        const packId = String(input.packId || '').trim();
        const runType = String(input.runType || '').trim();
        if (!packId) return 'Error: append_pack_audit 需要 packId。';
        if (!runType) return 'Error: append_pack_audit 需要 runType。';
        const numOrUndef = (v: unknown): number | undefined => {
          if (v == null || v === '') return undefined;
          const n = Number(v);
          return Number.isFinite(n) ? n : undefined;
        };
        const r = await E.appendPackAudit({
          packId,
          packVersion: input.packVersion != null ? String(input.packVersion) : undefined,
          runType,
          matched: numOrUndef(input.matched),
          leftOnly: numOrUndef(input.leftOnly),
          rightOnly: numOrUndef(input.rightOnly),
          conflict: numOrUndef(input.conflict),
          reviewPending: numOrUndef(input.reviewPending),
          sourceHashOrders: input.sourceHashOrders != null ? String(input.sourceHashOrders) : undefined,
          sourceHashAds: input.sourceHashAds != null ? String(input.sourceHashAds) : undefined,
          note: input.note != null ? String(input.note) : undefined,
          assumptionSnapshot:
            input.assumptionSnapshot != null ? String(input.assumptionSnapshot) : undefined,
          matchRate: numOrUndef(input.matchRate),
        });
        return JSON.stringify(r);
      }
      default: return `Unknown tool: ${tool.name}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (tool.name === "ensure_table" || tool.name === "reconcile_tables" || tool.name === "reshape_table" || tool.name === "calculate_table" || tool.name === "create_pivot" || tool.name === "write_inputs" || tool.name === "extract_selection" || tool.name === "sort_filter" || tool.name === "fill_range" || tool.name === "find_replace" || tool.name === "data_validation") {
      return `${tool.name} failed: ${msg}. This tool IS available — fix the arguments and retry. Do not use write_to_sheet.`;
    }
    return `Error: ${msg}`;
  }
}
