require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  parseProjectTargets,
  inferProjectColumns,
  parseExplicitProjectMap,
  colLetterToIndex,
} = require("../../src/excel/project-infer-core");

function pad25(row) {
  const r = row.slice();
  while (r.length < 25) r.push("");
  return r.slice(0, 25);
}

function amazonProfiles() {
  const headers = pad25([
    "+14",
    "Bedsure PureWove",
    "x",
    "4",
    "4 种尺码2",
    "4.4 颗星",
    "x",
    "(3.7万)",
    "200+ bought",
    "x",
    "CNY",
    "67",
    ".",
    "29",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "99",
    "",
    "88",
    "配送 12",
  ]);
  const sampleRows = [
    pad25([
      "+8",
      "BEDELITE",
      "x",
      "2",
      "3 种尺码1",
      "4.3 颗星",
      "x",
      "(1.2万)",
      "100+ bought",
      "x",
      "CNY",
      "50",
      ".",
      "00",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "79",
      "",
      "0",
      "FREE",
    ]),
  ];
  return { headers, sampleRows };
}

describe("project-infer-core", function () {
  it("parses targets from parentheses", function () {
    const t = parseProjectTargets("①整理成规整列（排名/标题/尺码数/评分/评论数/月购买/售价/市场价/配送费）");
    assert.deepStrictEqual(t.slice(0, 3), ["排名", "标题", "尺码数"]);
    assert.ok(t.indexOf("售价") >= 0);
    assert.strictEqual(t.length, 9);
  });

  it("maps column letters A=0 K=10 Y=24", function () {
    assert.strictEqual(colLetterToIndex("A"), 0);
    assert.strictEqual(colLetterToIndex("K"), 10);
    assert.strictEqual(colLetterToIndex("Y"), 24);
  });

  it("parses explicit A(0) style mapping", function () {
    const { headers, sampleRows } = amazonProfiles();
    const r = inferProjectColumns(
      headers,
      sampleRows,
      ["排名", "标题", "尺码数", "评分", "评论数", "月购买", "售价", "市场价", "配送费"],
      true,
      "排名 A(0) · 标题 B(1) · 尺码数 D(3) · 评分 F(5) · 评论数 H(7) · 月购买 I(8) · 售价 K(10) · 市场价 V(21) · 配送费 Y(24)"
    );
    assert.ok(r.columns);
    assert.strictEqual(r.columns.length, 9);
    const price = r.columns.find((c) => c.as === "售价");
    assert.deepStrictEqual(price.merge, [11, 12, 13]);
    const review = r.columns.find((c) => c.as === "评论数");
    assert.strictEqual(review.from, 7);
    assert.strictEqual(review.coerce, undefined);
    assert.strictEqual(r.columns.find((c) => c.as === "尺码数").from, 3);
  });

  it("infers amazon-like wide scrape without mixing review and price", function () {
    const { headers, sampleRows } = amazonProfiles();
    const r = inferProjectColumns(
      headers,
      sampleRows,
      ["排名", "标题", "尺码数", "评分", "评论数", "月购买", "售价", "市场价", "配送费"],
      true
    );
    assert.ok(r.columns);
    assert.strictEqual(r.columns.length, 9);
    const review = r.columns.find((c) => c.as === "评论数");
    const price = r.columns.find((c) => c.as === "售价");
    assert.strictEqual(review.from, 7);
    assert.notStrictEqual(review.from, price.merge[0]);
    assert.deepStrictEqual(price.merge, [11, 12, 13]);
    assert.strictEqual(r.columns.find((c) => c.as === "尺码数").from, 3);
  });

  it("infers rank title and merged price from scrape-like samples", function () {
    const headers = ["+14", "Bedsure PureWove", "选项:", "CNY", "67", ".", "29", "4.4 颗星", "1,234"];
    const sampleRows = [["+8", "BEDELITE", "选项:", "CNY", "50", ".", "00", "4.3 颗星", "890"]];
    const r = inferProjectColumns(headers, sampleRows, ["排名", "标题", "售价", "评分"], true);
    assert.ok(r.columns);
    assert.strictEqual(r.headerless, true);
    const rank = r.columns.find((c) => c.as === "排名");
    const title = r.columns.find((c) => c.as === "标题");
    const price = r.columns.find((c) => c.as === "售价");
    assert.strictEqual(rank.from, 0);
    assert.strictEqual(title.from, 1);
    assert.deepStrictEqual(price.merge, [4, 5, 6]);
  });
});
