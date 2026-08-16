const assert = require("assert");
const { mergeGrids, cellsToGrid, looksLikeHeaderRow } = require("../../../extension/picker-core.js");

describe("mergeGrids", function () {
  it("同宽同表头 → 表头只留一次，body 拼接", function () {
    assert.deepStrictEqual(
      mergeGrids([
        [
          ["a", "b"],
          ["1", "2"],
        ],
        [
          ["a", "b"],
          ["3", "4"],
        ],
      ]),
      [
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]
    );
  });

  it("同宽不同表头 → 两个表头都保留", function () {
    assert.deepStrictEqual(
      mergeGrids([
        [
          ["a", "b"],
          ["1", "2"],
        ],
        [
          ["x", "y"],
          ["3", "4"],
        ],
      ]),
      [
        ["a", "b"],
        ["1", "2"],
        ["x", "y"],
        ["3", "4"],
      ]
    );
  });

  it("不同宽 → 用空行隔开堆叠", function () {
    assert.deepStrictEqual(
      mergeGrids([
        [["a"], ["1"]],
        [
          ["x", "y"],
          ["2", "3"],
        ],
      ]),
      [["a"], ["1"], [], ["x", "y"], ["2", "3"]]
    );
  });

  it("空网格被滤掉", function () {
    assert.deepStrictEqual(mergeGrids([[], [["a"], ["1"]]]), [["a"], ["1"]]);
  });
});

describe("cellsToGrid", function () {
  it("同行两格 → 一行两列", function () {
    assert.deepStrictEqual(
      cellsToGrid([
        { x: 0, y: 0, w: 100, h: 20, t: "a" },
        { x: 100, y: 0, w: 100, h: 20, t: "b" },
      ]),
      [["a", "b"]]
    );
  });

  it("不同行 → 两行", function () {
    assert.deepStrictEqual(
      cellsToGrid([
        { x: 0, y: 0, w: 100, h: 20, t: "a" },
        { x: 0, y: 30, w: 100, h: 20, t: "b" },
      ]),
      [["a"], ["b"]]
    );
  });

  it("空文本格被滤掉", function () {
    assert.deepStrictEqual(
      cellsToGrid([
        { x: 0, y: 0, w: 100, h: 20, t: "" },
        { x: 100, y: 0, w: 100, h: 20, t: "b" },
      ]),
      [["b"]]
    );
  });

  it("无输入 → 空数组", function () {
    assert.deepStrictEqual(cellsToGrid([]), []);
  });
});

describe("looksLikeHeaderRow", function () {
  it("商品卡 → 不是表头（回归，原 vm 用例）", function () {
    assert.strictEqual(
      looksLikeHeaderRow(
        ["+14", "Bedsure PureWove", "选项:", "CNY 67.29", "4.4 颗星"],
        ["+8", "BEDELITE", "选项:", "CNY 50.00", "4.3 颗星"]
      ),
      false
    );
  });

  it("真表头 → 是表头", function () {
    assert.strictEqual(
      looksLikeHeaderRow(["店铺", "订单号", "金额", "日期"], ["A店", "123", "12.5", "2024-01-01"]),
      true
    );
  });
});
