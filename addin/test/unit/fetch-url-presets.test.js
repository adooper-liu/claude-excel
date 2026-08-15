require("ts-node/register/transpile-only");
const assert = require("assert");
const {
  FETCH_URL_PRESETS,
  applyFetchUrlPreset,
  groupFetchUrlPresets,
  presetShortLabel,
} = require("../../src/services/fetch-url-presets");

describe("fetch-url-presets", function () {
  it("lists marketplace search paths including ebay and 1688", function () {
    const ids = FETCH_URL_PRESETS.map((p) => p.id);
    assert.ok(ids.indexOf("amazon-search") >= 0);
    assert.ok(ids.indexOf("ebay-sold") >= 0);
    assert.ok(ids.indexOf("1688-search") >= 0);
    assert.ok(ids.indexOf("walmart-product") >= 0);
    const sold = FETCH_URL_PRESETS.find((p) => p.id === "ebay-sold");
    assert.match(applyFetchUrlPreset(sold), /LH_Sold=1/);
  });

  it("groups presets by marketplace", function () {
    const groups = groupFetchUrlPresets();
    assert.strictEqual(groups.length, 4);
    assert.strictEqual(groups[0].id, "amazon");
    assert.ok(groups[0].items.length >= 8);
    assert.strictEqual(presetShortLabel(groups[0].items[0]).indexOf("Amazon"), -1);
  });

  it("filters grouped presets by query", function () {
    const groups = groupFetchUrlPresets("已售");
    assert.strictEqual(groups.length, 1);
    assert.strictEqual(groups[0].id, "ebay");
    assert.strictEqual(groups[0].items.length, 1);
  });

  it("uses only public https marketplace URLs", function () {
    for (const p of FETCH_URL_PRESETS) {
      assert.match(p.url, /^https:\/\//);
      assert.ok(!/\/api\//.test(p.url));
      assert.ok(p.group);
    }
  });
});
