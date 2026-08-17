/** Pure profit formula helpers — no Office JS. */

import type { ProfitAssumptions } from "../services/user-fn";

export type AssumptionRow = {
  label: string;
  value: number;
  description: string;
};

export const ASSUMPTION_ORDER: Array<{
  key: keyof ProfitAssumptions;
  label: string;
  description: string;
}> = [
  { key: "referral_rate", label: "佣金率", description: "平台佣金率（小数）" },
  { key: "fba_fee_rate", label: "FBA费率", description: "FBA配送费率（小数）" },
  { key: "return_rate", label: "退款率", description: "退款率（小数）" },
  { key: "ad_rate", label: "广告费率", description: "广告费率参考（小数；实际广告费取 spend）" },
  { key: "cogs_rate", label: "COGS率", description: "采购+头程均摊率（小数）" },
  { key: "inbound_rate", label: "头程率", description: "头程均摊率参考（小数）" },
  { key: "storage_rate", label: "仓储率", description: "月度仓储均摊率（小数）" },
  { key: "fx_loss_rate", label: "支付手续费率", description: "支付/汇损率（小数）" },
  { key: "vat_rate", label: "VAT率", description: "VAT税率（小数）" },
  { key: "duty_rate", label: "关税率", description: "关税税率（小数）" },
  { key: "other_rate", label: "其他率", description: "其他均摊率（小数）" },
];

export function assumptionRows(rate: ProfitAssumptions): AssumptionRow[] {
  return ASSUMPTION_ORDER.map(function (item) {
    return {
      label: item.label,
      value: rate[item.key],
      description: item.description,
    };
  });
}

function assumptionCell(key: keyof ProfitAssumptions): string {
  const index = ASSUMPTION_ORDER.findIndex(function (item) {
    return item.key === key;
  });
  if (index < 0) throw new Error("unknown assumption key: " + key);
  return "$B$" + (2 + index);
}

function sheetRef(sheetName: string, cell: string): string {
  return "'" + sheetName + "'!" + cell;
}

/**
 * 每 SKU 一行的净利活公式：
 * 收入×(1−退款率) − 广告花费 − 收入×(佣金+FBA+COGS+仓储+支付/汇损+其他)
 */
export function netProfitFormula(opts: {
  row: number;
  reconTable: string;
  assumeSheet: string;
}): string {
  const { row, reconTable, assumeSheet } = opts;
  const item =
    "SUMIFS(" +
    reconTable +
    "[left_item_price]," +
    reconTable +
    "[left_platform_sku],A" +
    row +
    ")";
  const spend =
    "SUMIFS(" +
    reconTable +
    "[right_spend]," +
    reconTable +
    "[left_platform_sku],A" +
    row +
    ")";
  const refund = sheetRef(assumeSheet, assumptionCell("return_rate"));
  const costCells = [
    assumptionCell("referral_rate"),
    assumptionCell("fba_fee_rate"),
    assumptionCell("cogs_rate"),
    assumptionCell("storage_rate"),
    assumptionCell("fx_loss_rate"),
    assumptionCell("other_rate"),
  ]
    .map(function (c) {
      return sheetRef(assumeSheet, c);
    })
    .join("+");
  return "=" + item + "*(1-" + refund + ")-" + spend + "-" + item + "*(" + costCells + ")";
}
