require("ts-node/register/transpile-only");
const assert = require("assert");
const { assumptionRows, netProfitFormula } = require("../../src/excel/profit-formula-core");

const rate = {
  referral_rate: 0.15,
  fba_fee_rate: 0.12,
  return_rate: 0.03,
  ad_rate: 0.08,
  cogs_rate: 0.35,
  inbound_rate: 0.02,
  storage_rate: 0.01,
  fx_loss_rate: 0.01,
  vat_rate: 0,
  duty_rate: 0,
  other_rate: 0.02,
};

describe("profit-formula-core", function () {
  it("writes all 11 assumption rates in deterministic order", function () {
    const rows = assumptionRows(rate);
    assert.strictEqual(rows.length, 11);
    assert.deepStrictEqual(
      rows.map(function (r) {
        return r.label;
      }),
      [
        "佣金率",
        "FBA费率",
        "退款率",
        "广告费率",
        "COGS率",
        "头程率",
        "仓储率",
        "支付手续费率",
        "VAT率",
        "关税率",
        "其他率",
      ]
    );
    assert.strictEqual(rows[0].value, 0.15);
    assert.strictEqual(rows[3].value, 0.08);
  });

  it("builds a net profit live formula that subtracts spend and major cost rates", function () {
    const f = netProfitFormula({ row: 2, reconTable: "T_finance_recon", assumeSheet: "假设参数" });
    assert.strictEqual(f.startsWith("="), true);
    assert.ok(/SUMIFS\(T_finance_recon\[left_item_price\]/.test(f));
    assert.ok(/SUMIFS\(T_finance_recon\[right_spend\]/.test(f));
    assert.ok(/'假设参数'!\$B\$4/.test(f), "退款率引用");
    assert.ok(/'假设参数'!\$B\$2/.test(f), "佣金率引用");
    assert.ok(/'假设参数'!\$B\$12/.test(f), "其他率引用");
    assert.ok(/A2/.test(f), "SKU 条件引用");
  });
});
