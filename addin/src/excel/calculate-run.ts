import { inspectWorkbook } from "./inspect";
import {
  inferKey,
  inferValueColumn,
  parseCalculateIntent,
} from "./calculate-intent";
import { calculateTable } from "./calculate";
import { ensureTable } from "./table";
import { pickSourceSheets } from "./reconcile-intent";
import { pickSourceSheet } from "./reshape-intent";
import { askGenerateSample } from "./intent-guard";

/** Run inspect → ensure_table → calculate_table without asking the model. */
export async function runCalculateIntent(
  userText: string,
  onStep?: (msg: string) => void
): Promise<string> {
  const intent = parseCalculateIntent(userText);
  if (onStep) onStep("🔧 inspect_workbook({})");
  const wb = await inspectWorkbook();
  const sheets = wb.sheets
    .filter(function (s) {
      return !/对账|去重结果|反透视|拆列|类型结果|查找结果|汇总结果|公式修复/i.test(s.name);
    })
    .map(function (s) {
    return {
      name: s.name,
      range: s.range,
      rows: s.rows,
      headers: s.headers,
      tableNames: s.tableNames,
    };
  });

  if (intent.op === "fix_ref") {
    const data = sheets.filter(function (s) {
      return s.rows > 0;
    });
    const sheetName = data.length === 1 ? data[0].name : sheets[0] && sheets[0].name;
    if (!sheetName) return askGenerateSample("修公式");
    if (onStep) onStep('🔧 calculate_table({op:"fix_ref",sheetName:"' + sheetName + '"})');
    const r = await calculateTable({ op: "fix_ref", sheetName: sheetName });
    return [
      "已用 calculate_table 修复 #REF!。",
      "结果表：" + r.outputSheet,
      "修复 " + (r.formulaCells || 0) + " 个公式。源表未改。",
    ].join("\n");
  }

  if (intent.op === "lookup") {
    const picked = pickSourceSheets(sheets, intent.key || null);
    if (picked.length < 2) {
      const headed = sheets.filter(function (s) {
        return s.rows > 1 && s.headers.length > 0;
      });
      if (headed.length === 0) return askGenerateSample("匹配");
      throw new Error("查找需要两张带表头的表。请先准备好再试。");
    }
    if (onStep) onStep('🔧 ensure_table({"' + picked[0].name + '"})');
    const left = await ensureTable(
      picked[0].name,
      picked[0].range || undefined,
      picked[0].tableNames[0] || picked[0].name
    );
    if (onStep) onStep('🔧 ensure_table({"' + picked[1].name + '"})');
    const right = await ensureTable(
      picked[1].name,
      picked[1].range || undefined,
      picked[1].tableNames[0] || picked[1].name
    );
    const key = inferKey(left.headers, right.headers, intent.key);
    const bring = intent.bringColumns && intent.bringColumns.length
      ? intent.bringColumns
      : right.headers.filter(function (h) {
          return h && h !== key && left.headers.indexOf(h) < 0;
        });
    if (!bring.length) {
      throw new Error("请说明要取右表哪一列，例如：按订单号把金额匹配过来。右表列: " + right.headers.join("、"));
    }
    if (onStep) {
      onStep(
        '🔧 calculate_table({op:"lookup",leftTable:"' +
          left.name +
          '",rightTable:"' +
          right.name +
          '",key:"' +
          key +
          '"})'
      );
    }
    const r = await calculateTable({
      op: "lookup",
      leftTable: left.name,
      rightTable: right.name,
      key: key,
      bringColumns: bring,
    });
    return [
      "已用 calculate_table 按「" + key + "」写 INDEX/MATCH 取「" + bring.join("、") + "」。",
      "结果表：" + r.outputSheet + "（" + r.rows + " 行，公式仍引用源表）",
      "左表 " + left.name + "，右表 " + right.name + "。源表未改。",
    ].join("\n");
  }

  const picked = pickSourceSheet(sheets, { op: "dedupe", keys: intent.groupBy ? [intent.groupBy] : undefined });
  if (!picked) return askGenerateSample("求和");
  if (onStep) onStep('🔧 ensure_table({"' + picked.name + '"})');
  const table = await ensureTable(
    picked.name,
    picked.range || undefined,
    picked.tableNames[0] || picked.name
  );
  const groupBy = intent.groupBy;
  if (!groupBy) {
    throw new Error("请说明按哪一列求和，例如：按类别求和。现有列: " + table.headers.join("、"));
  }
  const valueColumn = intent.valueColumn || inferValueColumn(table.headers, groupBy);
  if (onStep) {
    onStep(
      '🔧 calculate_table({op:"sumifs",tableName:"' +
        table.name +
        '",groupBy:"' +
        groupBy +
        '"})'
    );
  }
  const r = await calculateTable({
    op: "sumifs",
    tableName: table.name,
    groupBy: groupBy,
    valueColumn: valueColumn,
  });
  return [
    "已用 calculate_table 按「" + groupBy + "」对「" + valueColumn + "」写 SUMIFS。",
    "结果表：" + r.outputSheet + "（" + r.rows + " 行，合计是活公式）",
    "源表 " + table.name + " 未改。",
  ].join("\n");
}
