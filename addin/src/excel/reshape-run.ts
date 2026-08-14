import { askGenerateSample } from "./intent-guard";
import { inspectWorkbook } from "./inspect";
import { parseReshapeIntent, pickSourceSheet } from "./reshape-intent";
import { reshapeTable } from "./reshape";
import { ensureTable } from "./table";

const OP_LABEL: Record<string, string> = {
  dedupe: "去重",
  unpivot: "反透视",
  split: "拆列",
  coerce: "类型强制",
};

/** Run inspect → ensure_table → reshape_table without asking the model. */
export async function runReshapeIntent(
  userText: string,
  onStep?: (msg: string) => void
): Promise<string> {
  const intent = parseReshapeIntent(userText);
  if (onStep) onStep("🔧 inspect_workbook({})");
  const wb = await inspectWorkbook();
  const sheets = wb.sheets.map(function (s) {
    return {
      name: s.name,
      range: s.range,
      rows: s.rows,
      headers: s.headers,
      tableNames: s.tableNames,
    };
  });
  const picked = pickSourceSheet(sheets, intent);
  if (!picked) return askGenerateSample(OP_LABEL[intent.op] || "整形");
  if (onStep) onStep('🔧 ensure_table({"' + picked.name + '"})');
  const table = await ensureTable(
    picked.name,
    picked.range || undefined,
    picked.tableNames[0] || picked.name
  );

  if (intent.op === "dedupe" && (!intent.keys || !intent.keys.length)) {
    throw new Error("请说明按哪一列去重，例如：按订单号去重。现有列: " + table.headers.join("、"));
  }
  if (intent.op === "split" && !intent.column) {
    throw new Error("请说明拆哪一列，例如：把标签按逗号拆开。现有列: " + table.headers.join("、"));
  }
  if (intent.op === "coerce" && !intent.column) {
    throw new Error("请说明哪一列转数字，例如：把金额转成数字。现有列: " + table.headers.join("、"));
  }

  if (onStep) {
    onStep(
      '🔧 reshape_table({tableName:"' + table.name + '",op:"' + intent.op + '"})'
    );
  }
  const r = await reshapeTable({
    tableName: table.name,
    op: intent.op,
    keys: intent.keys,
    column: intent.column,
    separator: intent.separator,
    type: intent.type,
  });

  const extra: string[] = [];
  if (r.dropped != null) extra.push("去掉重复 " + r.dropped + " 行");
  if (r.converted != null) extra.push("转换 " + r.converted + " 格");
  if (r.blanked) extra.push("无法转换 " + r.blanked + " 格");

  return [
    "已用 reshape_table 做" + OP_LABEL[r.op] + "。",
    "结果表：" + r.outputSheet + "（" + r.rows + " 行）",
    extra.length ? extra.join("，") + "。" : "",
    "源表 " + table.name + "（" + picked.name + "）未改。",
  ]
    .filter(Boolean)
    .join("\n");
}
