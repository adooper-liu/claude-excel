const fs = require("fs").promises;
const crypto = require("crypto");
const os = require("os");
const path = require("path");
const { OfficeMockObject } = require("office-addin-mock");
const { calculate } = require("../../src/excel/calculate-core");
const { appendPackAudit } = require("../../src/excel/pack-audit");
const { planPivot } = require("../../src/excel/pivot-core");
const { reconcile } = require("../../src/excel/reconcile-core");

function parseCsv(raw) {
  const lines = raw.trim().split(/\r?\n/);
  const headers = lines[0].split(",").map((cell) => cell.trim());
  const rows = lines.slice(1).map((line) => line.split(",").map((cell) => cell.trim()));
  return { headers, rows };
}

function rowObjects(data) {
  return data.rows.map((row) =>
    Object.fromEntries(data.headers.map((header, index) => [header, row[index]]))
  );
}

function sha256(raw) {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function skuKey(value) {
  return String(value || "").trim().toLowerCase();
}

function calculateProfit(sku, orders, ads) {
  const key = skuKey(sku);
  const skuOrders = orders.filter((row) => skuKey(row.platform_sku) === key);
  const skuAds = ads.filter((row) => skuKey(row.platform_sku) === key);
  const exchangeRate = 7.2;
  const revenue = skuOrders
    .filter((row) => !row.is_refund)
    .reduce((sum, row) => sum + row.quantity * row.item_price * exchangeRate, 0);
  const quantity = skuOrders.reduce((sum, row) => sum + row.quantity, 0);
  const commission = revenue * 0.15;
  const fba = quantity * 3.22 * (1 + 0.035) * exchangeRate;
  const storage = quantity * 1.5 * exchangeRate;
  const advertising = skuAds.reduce((sum, row) => sum + row.spend * exchangeRate, 0);
  const refund = skuOrders.some((row) => row.is_refund) ? revenue * 0.08 : 0;
  const paymentFee = revenue * 0.025;
  const netProfit = revenue - commission - fba - storage - advertising - refund - paymentFee;
  return [sku, revenue, netProfit, revenue === 0 ? "" : netProfit / revenue];
}

function createExcelMock(workbook) {
  const rawSheets = Object.keys(workbook.sheets).map((name) => createWorksheet(name));

  function createRange(sheetName, startRow, startColumn, rowCount, columnCount) {
    const range = { format: { font: { bold: false } } };
    Object.defineProperty(range, "values", {
      get: function () {
        const sheet = workbook.sheets[sheetName];
        return Array.from({ length: rowCount }, (_, rowOffset) =>
          Array.from({ length: columnCount }, (_, columnOffset) =>
            sheet.rows[startRow + rowOffset]?.[startColumn + columnOffset]
          )
        );
      },
      set: function (rows) {
        const sheet = workbook.sheets[sheetName];
        rows.forEach((row, rowOffset) => {
          const targetRow = startRow + rowOffset;
          if (!sheet.rows[targetRow]) sheet.rows[targetRow] = [];
          row.forEach((value, columnOffset) => {
            sheet.rows[targetRow][startColumn + columnOffset] = value;
          });
        });
      },
    });
    return range;
  }

  function createWorksheet(name) {
    return {
      name,
      getRangeByIndexes: function (startRow, startColumn, rowCount, columnCount) {
        return createRange(name, startRow, startColumn, rowCount, columnCount);
      },
      getUsedRangeOrNullObject: function () {
        const rowCount = workbook.sheets[name].rows.length;
        return {
          rowCount,
          isNullObject: rowCount === 0,
          load: function () {},
        };
      },
    };
  }

  const worksheets = {
    items: rawSheets,
    load: function () {
      this.items = rawSheets;
    },
    add: function (name) {
      workbook.sheets[name] = { rows: [] };
      const sheet = createWorksheet(name);
      rawSheets.push(sheet);
      return sheet;
    },
    getItem: function (name) {
      const sheet = rawSheets.find((item) => item.name === name);
      if (!sheet) throw new Error("missing mock worksheet: " + name);
      return sheet;
    },
  };
  return new OfficeMockObject({
    context: { workbook: { worksheets } },
    run: async function (callback) {
      return callback(this.context);
    },
  });
}

async function withTempFixtures(sourceDir, callback) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "finance-e2e-"));
  const fixtures = {
    orders: path.join(tempDir, "orders.csv"),
    ads: path.join(tempDir, "ads.csv"),
  };
  try {
    await Promise.all([
      fs.copyFile(path.join(sourceDir, "orders.csv"), fixtures.orders),
      fs.copyFile(path.join(sourceDir, "ads.csv"), fixtures.ads),
    ]);
    return await callback(fixtures);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runFinanceRecipe(fixtures) {
  const [orderRaw, adRaw] = await Promise.all([
    fs.readFile(fixtures.orders, "utf8"),
    fs.readFile(fixtures.ads, "utf8"),
  ]);
  const orders = rowObjects(parseCsv(orderRaw)).map((row) => ({
    platform_sku: skuKey(row.platform_sku),
    biz_date: row.order_date,
    quantity: Number(row.quantity),
    item_price: Number(row.item_price),
    is_refund: row.is_refund === "true",
  }));
  const ads = rowObjects(parseCsv(adRaw)).map((row) => ({
    platform_sku: skuKey(row.platform_sku),
    biz_date: row.ad_date,
    spend: Number(row.spend),
  }));

  const reconciliation = reconcile({
    leftHeaders: ["platform_sku", "biz_date", "quantity", "item_price", "is_refund"],
    leftRows: orders.map((row) => Object.values(row)),
    rightHeaders: ["platform_sku", "biz_date", "spend"],
    rightRows: ads.map((row) => Object.values(row)),
    keys: ["platform_sku", "biz_date"],
    matchMode: "date_window",
    keyNormalize: "trim_lower",
    dateWindowDays: 7,
    leftDateKey: "biz_date",
    rightDateKey: "biz_date",
    compareTolerance: 0.01,
  });
  const profitSkeleton = calculate({
    op: "sumifs",
    tableName: "T_finance_recon",
    headers: reconciliation.outputHeaders,
    rows: reconciliation.outputRows.slice(1),
    groupBy: "left_platform_sku",
    valueColumn: "left_quantity",
  });
  const pivotPlan = planPivot(["SKU", "收入", "净利", "净利率"], {
    rows: ["SKU"],
    values: [
      { field: "收入", aggregation: "sum" },
      { field: "净利", aggregation: "sum" },
      { field: "净利率", aggregation: "average" },
    ],
  });
  const profitRows = profitSkeleton.rows.map((row) => calculateProfit(row[0], orders, ads));
  const workbook = {
    sheets: {
      "业财对账结果": { rows: reconciliation.outputRows },
      "业财利润公式": { rows: [["SKU", "收入", "净利", "净利率"], ...profitRows] },
      "业财利润透视": { rows: [[...pivotPlan.rows, ...pivotPlan.values.map((v) => v.field)], ...profitRows] },
    },
  };

  const counts = reconciliation.counts;
  const total = counts.matched + counts.left_only + counts.right_only + counts.conflict;
  const previousExcel = global.Excel;
  try {
    global.Excel = createExcelMock(workbook);
    await appendPackAudit({
      packId: "cross-border-ecommerce-finance",
      packVersion: "0.1.0",
      runType: "finance-reconciliation",
      matched: counts.matched,
      leftOnly: counts.left_only,
      rightOnly: counts.right_only,
      conflict: counts.conflict,
      reviewPending: reconciliation.reviewPending,
      sourceHashOrders: sha256(orderRaw),
      sourceHashAds: sha256(adRaw),
      note: "finance E2E fixture",
      assumptionSnapshot: '{"B2":7.2,"B3":0.15,"B4":0.08}',
      matchRate: total > 0 ? counts.matched / total : 0,
    });
  } finally {
    global.Excel = previousExcel;
  }

  return { workbook, reconciliation, pivotPlan };
}

module.exports = { runFinanceRecipe, withTempFixtures };
