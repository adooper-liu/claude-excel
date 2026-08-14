import { inspectWorkbook } from "./inspect";
import { parseKeyFromText, pickSourceSheets, inferKeys } from "./reconcile-intent";
import { reconcileTables } from "./reconcile";
import { ensureTable } from "./table";
import { askGenerateSample } from "./intent-guard";

/** Run inspect → ensure_table → reconcile_tables without asking the model. */
export async function runReconcileIntent(
  userText: string,
  onStep?: (msg: string) => void
): Promise<string> {
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
  const picked = pickSourceSheets(sheets, parseKeyFromText(userText));
  if (picked.length < 2) {
    const headed = sheets.filter(function (s) {
      return s.rows > 1 && s.headers.length > 0;
    });
    if (headed.length === 0) return askGenerateSample("对账");
    const named = headed.map(function (s) { return s.name; }).join("、");
    throw new Error("需要对账的两张带表头的表。当前有数据的工作表：" + named);
  }

  if (onStep) onStep("🔧 ensure_table({\"" + picked[0].name + "\"})");
  const left = await ensureTable(
    picked[0].name,
    picked[0].range || undefined,
    picked[0].tableNames[0] || picked[0].name
  );
  if (onStep) onStep("🔧 ensure_table({\"" + picked[1].name + "\"})");
  const right = await ensureTable(
    picked[1].name,
    picked[1].range || undefined,
    picked[1].tableNames[0] || picked[1].name
  );

  const keys = inferKeys(userText, left.headers, right.headers);
  if (onStep) {
    onStep(
      "🔧 reconcile_tables({leftTable:\"" +
        left.name +
        "\",rightTable:\"" +
        right.name +
        "\",keys:[\"" +
        keys.join("\",\"") +
        "\"]})"
    );
  }
  const r = await reconcileTables({
    leftTable: left.name,
    rightTable: right.name,
    keys: keys,
  });

  return [
    "已用 reconcile_tables 按「" + keys.join("、") + "」对账。",
    "结果表：" + r.outputSheet,
    "matched " +
      r.counts.matched +
      " / left_only " +
      r.counts.left_only +
      " / right_only " +
      r.counts.right_only +
      " / conflict " +
      r.counts.conflict,
    "左表 " + left.name + "（" + picked[0].name + "），右表 " + right.name + "（" + picked[1].name + "）。",
  ].join("\n");
}
