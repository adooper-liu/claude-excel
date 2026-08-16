import { calculateTable } from "./calculate";
import { loadConnectorFeed } from "../services/user-fn";
import { appendPackAudit } from "./pack-audit";
import { createPivot } from "./pivot";
import { reconcileTables } from "./reconcile";
import { getSheetNames } from "./sheet";
import { ensureTable } from "./table";
import { writeInputs } from "./write-inputs";
import { writeToNewSheet } from "./write";

const PACK_ID = "cross-border-ecommerce-finance";
const PACK_VERSION = "0.1.0";
const ORDER_SHEET = "Pack_订单";
const ADS_SHEET = "Pack_广告";
const ASSUME_SHEET = "假设参数";
const RECONCILE_SHEET = "业财对账结果";
const RECONCILE_TABLE = "T_finance_recon";
const PROFIT_FORMULA_SHEET = "业财利润公式";
const PROFIT_FORMULA_TABLE = "T_finance_profit";
const PIVOT_SHEET = "业财利润透视";
const RECONCILE_KEYS = ["platform_sku", "biz_date"];

export function isFinanceRequest(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/跨境业财|业财对账|Pack_订单.*Pack_广告|订单.*广告.*对账.*利润|毛利透视/i.test(t)) {
    return true;
  }
  return false;
}

async function ensureAssumeSheet(onStep?: (msg: string) => void): Promise<void> {
  const headerGrid: (string | number)[][] = [
    ["参数", "值", "说明"],
    ["USD汇率", "", "用户提供/待验证"],
    ["广告占比", "", "默认假设"],
    ["退款率", "", "默认假设"],
    ["归因说明", "点击日vs成交日0-7天偏移", "只标注不解决"],
  ];
  const names = await getSheetNames();
  if (names.indexOf(ASSUME_SHEET) < 0) {
    if (onStep) onStep('🔧 writeToNewSheet("' + ASSUME_SHEET + '") 表头');
    await writeToNewSheet(ASSUME_SHEET, headerGrid);
  }
  if (onStep) {
    onStep('🔧 write_inputs({sheet:"' + ASSUME_SHEET + '",cells:["B2","B3","B4"]})');
  }
  await writeInputs(ASSUME_SHEET, [
    { address: "B2", value: 7.2 },
    { address: "B3", value: 0.08 },
    { address: "B4", value: 0.03 },
  ]);
}

/** Gate 1b: fixture → Pack sheets → reconcile → 假设 → pivot → _pack_audit */
export async function runFinanceIntent(
  _userText: string,
  onStep?: (msg: string) => void
): Promise<string> {
  if (onStep) onStep('🔧 user.connector_load_feed({feed:"orders"})');
  let orders;
  let ads;
  try {
    orders = await loadConnectorFeed("orders", PACK_ID);
    if (onStep) onStep('🔧 user.connector_load_feed({feed:"ads"})');
    ads = await loadConnectorFeed("ads", PACK_ID);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      "无法加载 connector fixture：" +
        msg +
        "。请先安装「跨境电商业财包」（cross-border-ecommerce-finance）并同意本机扩展（user.connector_load_feed）。"
    );
  }

  const orderGrid = [orders.headers, ...orders.rows] as (string | number)[][];
  const adsGrid = [ads.headers, ...ads.rows] as (string | number)[][];

  if (onStep) onStep('🔧 writeToNewSheet("' + ORDER_SHEET + '")');
  const orderWritten = await writeToNewSheet(ORDER_SHEET, orderGrid);
  if (onStep) onStep('🔧 writeToNewSheet("' + ADS_SHEET + '")');
  const adsWritten = await writeToNewSheet(ADS_SHEET, adsGrid);

  if (onStep) onStep('🔧 ensure_table("' + orderWritten + '")');
  const left = await ensureTable(orderWritten, undefined, orderWritten);
  if (onStep) onStep('🔧 ensure_table("' + adsWritten + '")');
  const right = await ensureTable(adsWritten, undefined, adsWritten);

  if (onStep) {
    onStep(
      '🔧 reconcile_tables({leftTable:"' +
        left.name +
        '",rightTable:"' +
        right.name +
        '",keys:["platform_sku","biz_date"]})'
    );
  }
  const recon = await reconcileTables({
    leftTable: left.name,
    rightTable: right.name,
    keys: RECONCILE_KEYS,
    outputSheet: RECONCILE_SHEET,
    outputTable: RECONCILE_TABLE,
  });
  const reconTable = recon.outputTable;

  await ensureAssumeSheet(onStep);

  if (onStep) {
    onStep(
      '🔧 calculate_table({op:"sumifs",tableName:"' +
        reconTable +
        '",groupBy:"left_platform_sku",valueColumn:"left_item_price"})'
    );
  }
  const profitFormula = await calculateTable({
    op: "sumifs",
    tableName: reconTable,
    groupBy: "left_platform_sku",
    valueColumn: "left_item_price",
    outputSheet: PROFIT_FORMULA_SHEET,
    outputTable: PROFIT_FORMULA_TABLE,
  });

  if (onStep) {
    onStep(
      '🔧 create_pivot({tableName:"' +
        reconTable +
        '",rows:["left_platform_sku","left_biz_date"],values:[item_price,spend]})'
    );
  }
  const pivot = await createPivot({
    tableName: reconTable,
    rows: ["left_platform_sku", "left_biz_date"],
    values: [
      { field: "left_item_price", aggregation: "sum" },
      { field: "right_spend", aggregation: "sum" },
    ],
    outputSheet: PIVOT_SHEET,
  });

  const ordersHash = String(orders.meta?.sourceHash || "");
  const adsHash = String(ads.meta?.sourceHash || "");
  const attrNote = String(orders.meta?.attributionNote || ads.meta?.attributionNote || "");
  const total =
    recon.counts.matched +
    recon.counts.left_only +
    recon.counts.right_only +
    recon.counts.conflict;
  const auditNote = [attrNote, "matched=" + recon.counts.matched + "/" + total]
    .filter(Boolean)
    .join("；");

  if (onStep) onStep("🔧 appendPackAudit(_pack_audit)");
  await appendPackAudit({
    packId: PACK_ID,
    packVersion: PACK_VERSION,
    runType: "finance-reconciliation",
    matched: recon.counts.matched,
    leftOnly: recon.counts.left_only,
    rightOnly: recon.counts.right_only,
    conflict: recon.counts.conflict,
    sourceHashOrders: ordersHash,
    sourceHashAds: adsHash,
    note: auditNote,
  });

  return [
    "已跑完 Gate 1b 业财闭环（fixture → 对账 → 假设 → 透视 → 审计）。",
    "订单表：" + orderWritten + "（" + orders.rows.length + " 行，hash " + ordersHash + "）",
    "广告表：" + adsWritten + "（" + ads.rows.length + " 行，hash " + adsHash + "）",
    "对账结果：" +
      recon.outputSheet +
      "（表 " +
      reconTable +
      "）— matched " +
      recon.counts.matched +
      " / left_only " +
      recon.counts.left_only +
      " / right_only " +
      recon.counts.right_only +
      " / conflict " +
      recon.counts.conflict,
    "假设参数：" + ASSUME_SHEET + "（write_inputs 写入 B2–B4 汇率/占比/退款率）",
    "活公式：" + profitFormula.outputSheet + "（按 SKU SUMIFS item_price，随源表变）",
    "透视表：" + pivot.sheet + "（按 SKU+日期切片 item_price 与 spend）",
    "审计：_pack_audit 已追加一行（含 sourceHash 与归因说明）。",
  ].join("\n");
}
