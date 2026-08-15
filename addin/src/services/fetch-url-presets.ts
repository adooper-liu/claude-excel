/** Common marketplace SERP / listing URL templates for the fetch bar. */

export interface FetchUrlPreset {
  id: string;
  group: string;
  label: string;
  url: string;
  hint?: string;
}

export interface FetchUrlPresetGroup {
  id: string;
  label: string;
  items: FetchUrlPreset[];
}

/** Placeholders user replaces before opening the page. */
export const FETCH_URL_PRESETS: FetchUrlPreset[] = [
  {
    id: "amazon-search",
    group: "amazon",
    label: "Amazon · 关键词搜索",
    url: "https://www.amazon.com/s?k=关键词",
    hint: "美国站关键词搜索",
  },
  {
    id: "amazon-search-price-asc",
    group: "amazon",
    label: "Amazon · 低价排序",
    url: "https://www.amazon.com/s?k=关键词&s=price-asc-rank",
    hint: "sort=price-asc-rank",
  },
  {
    id: "amazon-search-price-desc",
    group: "amazon",
    label: "Amazon · 高价排序",
    url: "https://www.amazon.com/s?k=关键词&s=price-desc-rank",
    hint: "sort=price-desc-rank",
  },
  {
    id: "amazon-search-review",
    group: "amazon",
    label: "Amazon · 评价排序",
    url: "https://www.amazon.com/s?k=关键词&s=review-rank",
    hint: "sort=review-rank",
  },
  {
    id: "amazon-search-new",
    group: "amazon",
    label: "Amazon · 最新上架",
    url: "https://www.amazon.com/s?k=关键词&s=date-desc-rank",
    hint: "sort=date-desc-rank",
  },
  {
    id: "amazon-search-bestseller",
    group: "amazon",
    label: "Amazon · 畅销",
    url: "https://www.amazon.com/s?k=关键词&s=exact-aware-popularity-rank",
    hint: "sort=exact-aware-popularity-rank",
  },
  {
    id: "amazon-search-page2",
    group: "amazon",
    label: "Amazon · 第 2 页",
    url: "https://www.amazon.com/s?k=关键词&page=2",
    hint: "page=2，翻页后在网页点追加",
  },
  {
    id: "amazon-product",
    group: "amazon",
    label: "Amazon · 商品详情 ASIN",
    url: "https://www.amazon.com/dp/ASIN",
    hint: "商品详情页，把 ASIN 换成目标商品",
  },
  {
    id: "amazon-de-search",
    group: "amazon",
    label: "Amazon.de · 德语搜索",
    url: "https://www.amazon.de/s?k=关键词",
    hint: "德国站",
  },
  {
    id: "amazon-co-jp-search",
    group: "amazon",
    label: "Amazon.co.jp · 日语搜索",
    url: "https://www.amazon.co.jp/s?k=关键词",
    hint: "日本站",
  },
  {
    id: "walmart-search",
    group: "walmart",
    label: "Walmart · 关键词搜索",
    url: "https://www.walmart.com/search?q=关键词",
    hint: "Walmart 列表页",
  },
  {
    id: "walmart-product",
    group: "walmart",
    label: "Walmart · 商品详情",
    url: "https://www.walmart.com/ip/商品ID",
    hint: "URL 里的数字即 ItemId",
  },
  {
    id: "ebay-search",
    group: "ebay",
    label: "eBay · 关键词搜索",
    url: "https://www.ebay.com/sch/i.html?_nkw=关键词",
    hint: "美国站 eBay 搜索",
  },
  {
    id: "ebay-sold",
    group: "ebay",
    label: "eBay · 已售成交",
    url: "https://www.ebay.com/sch/i.html?_nkw=关键词&LH_Sold=1&LH_Complete=1",
    hint: "已结束且已售出，用于比价",
  },
  {
    id: "ebay-price-low",
    group: "ebay",
    label: "eBay · 低价排序",
    url: "https://www.ebay.com/sch/i.html?_nkw=关键词&_sop=15",
    hint: "价格+运费从低到高",
  },
  {
    id: "ebay-auction",
    group: "ebay",
    label: "eBay · 拍卖即将结束",
    url: "https://www.ebay.com/sch/i.html?_nkw=关键词&_sop=1",
    hint: "拍卖 listing，按结束时间",
  },
  {
    id: "ebay-de-search",
    group: "ebay",
    label: "eBay.de · 德语搜索",
    url: "https://www.ebay.de/sch/i.html?_nkw=关键词",
    hint: "德国站",
  },
  {
    id: "1688-search",
    group: "1688",
    label: "1688 · 关键词搜索",
    url: "https://s.1688.com/selloffer/offer_search.htm?keywords=关键词",
    hint: "关键词须中文",
  },
  {
    id: "1688-product",
    group: "1688",
    label: "1688 · 商品详情",
    url: "https://detail.1688.com/offer/商品ID.html",
    hint: "offerId 在 URL 路径中",
  },
];

const GROUP_ORDER: { id: string; label: string }[] = [
  { id: "amazon", label: "Amazon" },
  { id: "walmart", label: "Walmart" },
  { id: "ebay", label: "eBay" },
  { id: "1688", label: "1688" },
];

export function applyFetchUrlPreset(preset: FetchUrlPreset): string {
  return preset.url;
}

export function presetShortLabel(preset: FetchUrlPreset): string {
  const dot = preset.label.indexOf(" · ");
  return dot >= 0 ? preset.label.slice(dot + 3) : preset.label;
}

export function groupFetchUrlPresets(filter?: string): FetchUrlPresetGroup[] {
  const q = String(filter || "")
    .trim()
    .toLowerCase();
  const out: FetchUrlPresetGroup[] = [];
  for (const g of GROUP_ORDER) {
    const items = FETCH_URL_PRESETS.filter(function (p) {
      if (p.group !== g.id) return false;
      if (!q) return true;
      return (
        p.label.toLowerCase().indexOf(q) >= 0 ||
        p.url.toLowerCase().indexOf(q) >= 0 ||
        presetShortLabel(p).toLowerCase().indexOf(q) >= 0
      );
    });
    if (items.length) out.push({ id: g.id, label: g.label, items: items });
  }
  return out;
}
