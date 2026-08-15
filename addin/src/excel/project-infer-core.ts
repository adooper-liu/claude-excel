import { indexToCol } from "./formula-inspect-core";

import type { ProjectColumnSpec } from "./reshape-core";

export interface ColumnProfile {
  index: number;
  letter: string;
  samples: string[];
  avgLen: number;
  numericRate: number;
  priceFragRate: number;
  starRate: number;
  rankRate: number;
  buyRate: number;
  shipRate: number;
  marketRate: number;
  sizeRate: number;
  reviewTextRate: number;
  sizeCountRate: number;
}

function cellStr(v: unknown): string {
  return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
}

export function colLetterToIndex(letter: string): number {
  const s = String(letter || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return -1;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64);
  }
  return n - 1;
}

function profileColumn(index: number, letter: string, cells: string[]): ColumnProfile {
  const samples = cells.filter(Boolean).slice(0, 12);
  let numeric = 0;
  let priceFrag = 0;
  let star = 0;
  let rank = 0;
  let buy = 0;
  let ship = 0;
  let market = 0;
  let size = 0;
  let reviewText = 0;
  let sizeCount = 0;
  let lenSum = 0;
  for (const s of samples) {
    lenSum += s.length;
    if (/^\+?\d+$/.test(s) || /^\d+$/.test(s)) numeric += 1;
    if (/^\d{3,}$/.test(s) || s === "." || /^CNY/i.test(s)) priceFrag += 1;
    if (/颗星/.test(s)) star += 1;
    else if (/^\d\.\d/.test(s) && Number(s) <= 5) star += 1;
    if (/^\+?\d{1,4}$/.test(s)) rank += 1;
    if (/购买|past month|month|bought/i.test(s)) buy += 1;
    if (/配送|shipping|预计|送达|delivery/i.test(s)) ship += 1;
    if (/市场价|list price|was price/i.test(s)) market += 1;
    if (/尺码|尺寸|选项:/i.test(s)) size += 1;
    if (/万|\([\d.]+万\)|,\d{3,}|^\([\d.]+\)$/.test(s)) reviewText += 1;
    if (/^-\d+$/.test(s)) reviewText += 0.5;
    if (/^\d{1,2}$/.test(s) && !/^\+/.test(s)) sizeCount += 1;
  }
  const n = Math.max(samples.length, 1);
  return {
    index,
    letter,
    samples,
    avgLen: lenSum / n,
    numericRate: numeric / n,
    priceFragRate: priceFrag / n,
    starRate: star / n,
    rankRate: rank / n,
    buyRate: buy / n,
    shipRate: ship / n,
    marketRate: market / n,
    sizeRate: size / n,
    reviewTextRate: reviewText / n,
    sizeCountRate: sizeCount / n,
  };
}

export function parseProjectTargets(text: string): string[] {
  const t = String(text || "");
  const paren = t.match(/[（(]([^）)]+)[）)]/);
  const raw = paren ? paren[1] : t;
  const parts = raw
    .split(/[/／、,，|]/)
    .map((s) => s.replace(/^[①②③④⑤⑥⑦⑧⑨⑩\d.\s]+/, "").trim())
    .filter(Boolean);
  const uniq: string[] = [];
  for (const p of parts) {
    if (uniq.indexOf(p) < 0 && p.length <= 12 && /[\u4e00-\u9fa5A-Za-z]/.test(p)) uniq.push(p);
  }
  return uniq;
}

const EXPLICIT_MAP_RE =
  /(排名|标题|尺码数|评分|评论数|月购买|售价|市场价|配送费)\s+([A-Z]+)\s*[（(]\s*(\d+)\s*[）)]/gi;

function pickBest(profiles: ColumnProfile[], used: Set<number>, score: (p: ColumnProfile) => number): number | null {
  let best: number | null = null;
  let bestScore = -Infinity;
  for (const p of profiles) {
    if (used.has(p.index)) continue;
    const s = score(p);
    if (s > bestScore) {
      bestScore = s;
      best = p.index;
    }
  }
  return bestScore > 0.05 ? best : null;
}

function allSamplesMatch(samples: string[], pattern: RegExp): boolean {
  return samples.length > 0 && samples.every((s) => pattern.test(s));
}

function isPriceIntPart(samples: string[]): boolean {
  return allSamplesMatch(samples, /^\d+$/);
}

function isPriceDotPart(samples: string[]): boolean {
  return allSamplesMatch(samples, /^[.．]$/);
}

function isPriceFracPart(samples: string[]): boolean {
  return allSamplesMatch(samples, /^\d{1,2}$/);
}

function findPriceMerge(profiles: ColumnProfile[], used: Set<number>): number[] | null {
  for (let i = 0; i < profiles.length - 3; i++) {
    const a = profiles[i];
    const b = profiles[i + 1];
    const c = profiles[i + 2];
    const d = profiles[i + 3];
    if (used.has(a.index) || used.has(b.index) || used.has(c.index) || used.has(d.index)) continue;
    if (
      allSamplesMatch(a.samples, /^CNY/i) &&
      isPriceIntPart(b.samples) &&
      isPriceDotPart(c.samples) &&
      isPriceFracPart(d.samples)
    ) {
      return [b.index, c.index, d.index];
    }
  }
  for (let i = 0; i < profiles.length - 2; i++) {
    const a = profiles[i];
    const b = profiles[i + 1];
    const c = profiles[i + 2];
    if (used.has(a.index) || used.has(b.index) || used.has(c.index)) continue;
    if (isPriceIntPart(a.samples) && isPriceDotPart(b.samples) && isPriceFracPart(c.samples)) {
      return [a.index, b.index, c.index];
    }
  }
  for (let i = 0; i < profiles.length - 2; i++) {
    const a = profiles[i];
    const b = profiles[i + 1];
    const c = profiles[i + 2];
    if (used.has(a.index) || used.has(b.index) || used.has(c.index)) continue;
    if (
      allSamplesMatch(a.samples, /^CNY/i) &&
      isPriceIntPart(b.samples) &&
      (isPriceDotPart(c.samples) || isPriceFracPart(c.samples))
    ) {
      return [b.index, c.index];
    }
  }
  return null;
}

function priceMergeAt(profiles: ColumnProfile[], idx: number): number[] | null {
  if (idx < 0 || idx >= profiles.length) return null;
  const p = profiles[idx];
  if (p && allSamplesMatch(p.samples, /^CNY/i) && idx + 3 < profiles.length) {
    const b = profiles[idx + 1];
    const c = profiles[idx + 2];
    const d = profiles[idx + 3];
    if (isPriceIntPart(b.samples) && isPriceDotPart(c.samples) && isPriceFracPart(d.samples)) {
      return [b.index, c.index, d.index];
    }
  }
  const used = new Set<number>();
  for (let start = Math.max(0, idx - 2); start <= idx; start++) {
    if (start + 2 >= profiles.length) continue;
    const a = profiles[start];
    const b = profiles[start + 1];
    const c = profiles[start + 2];
    if (a.index <= idx && idx <= c.index) {
      if (isPriceIntPart(a.samples) && isPriceDotPart(b.samples) && isPriceFracPart(c.samples)) {
        return [a.index, b.index, c.index];
      }
    }
  }
  return findPriceMerge(profiles, used);
}

function reviewCoerce(samples: string[]): "number" | undefined {
  if (samples.some((s) => /万|\(/.test(s))) return undefined;
  return "number";
}

export function parseExplicitProjectMap(
  text: string,
  targetNames: string[],
  profiles: ColumnProfile[]
): ProjectColumnSpec[] | null {
  const found = new Map<string, number>();
  const re = new RegExp(EXPLICIT_MAP_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ""))) !== null) {
    const name = m[1];
    const idx = parseInt(m[3], 10);
    if (!Number.isNaN(idx)) found.set(name, idx);
  }
  if (found.size < 3) return null;

  const specs: ProjectColumnSpec[] = [];
  for (const name of targetNames) {
    const idx = found.get(name);
    if (idx == null) continue;
    if (name === "售价") {
      const merge = priceMergeAt(profiles, idx);
      if (merge) {
        specs.push({ as: name, merge, separator: "", coerce: "number" });
      } else {
        specs.push({ as: name, from: idx, coerce: "number" });
      }
      continue;
    }
    if (name === "评论数") {
      const samples = profiles[idx] ? profiles[idx].samples : [];
      specs.push({ as: name, from: idx, coerce: reviewCoerce(samples) });
      continue;
    }
    if (name === "评分") {
      specs.push({ as: name, from: idx, coerce: "number" });
      continue;
    }
    if (name === "市场价" || name === "配送费") {
      specs.push({ as: name, from: idx, coerce: "number" });
      continue;
    }
    specs.push({ as: name, from: idx });
  }
  return specs.length >= Math.min(3, targetNames.length) ? specs : null;
}

function buildProfiles(headers: string[], sampleRows: unknown[][], headerless: boolean): ColumnProfile[] {
  const rows = headerless ? [headers, ...sampleRows] : sampleRows;
  const width = Math.max(headers.length, ...rows.map((r) => (r ? r.length : 0)));
  const profiles: ColumnProfile[] = [];
  for (let i = 0; i < width; i++) {
    const cells = rows.map((r) => cellStr(Array.isArray(r) ? r[i] : ""));
    profiles.push(profileColumn(i, indexToCol(i), cells));
  }
  return profiles;
}

export function inferProjectColumns(
  headers: string[],
  sampleRows: unknown[][],
  targetNames: string[],
  headerless: boolean,
  hintText?: string
): { columns: ProjectColumnSpec[]; headerless: boolean } | { error: string } {
  if (!targetNames.length) {
    return { error: "请列出目标列名，例如：排名/标题/售价（用 / 或 、 分隔）。" };
  }

  const profiles = buildProfiles(headers, sampleRows, headerless);
  if (profiles.length < 2) return { error: "表太窄，无法推断列映射。" };

  const explicit = parseExplicitProjectMap(hintText || "", targetNames, profiles);
  if (explicit) {
    return { columns: explicit, headerless: !!headerless };
  }

  const used = new Set<number>();
  const specs: ProjectColumnSpec[] = [];
  const want = new Set(targetNames);
  const width = profiles.length;

  function markUsed(spec: ProjectColumnSpec) {
    if (spec.from != null && typeof spec.from === "number") used.add(spec.from);
    if (spec.merge) {
      spec.merge.forEach(function (m) {
        if (typeof m === "number") used.add(m);
      });
    }
  }

  function addFrom(name: string, spec: ProjectColumnSpec) {
    if (!want.has(name)) return;
    specs.push(spec);
    markUsed(spec);
  }

  const rankIdx = pickBest(profiles, used, (p) => p.rankRate * 2 + (p.index === 0 ? 0.3 : 0));
  if (want.has("排名") && rankIdx != null) addFrom("排名", { as: "排名", from: rankIdx });

  const titleIdx = pickBest(profiles, used, (p) => {
    if (p.buyRate > 0.2 || p.rankRate > 0.5) return -1;
    if (p.index === 0) return -1;
    return (
      p.avgLen * 0.08 +
      (p.priceFragRate < 0.3 ? 0.2 : 0) +
      (p.index === 1 ? 0.6 : p.index <= 3 ? 0.1 : -0.2)
    );
  });
  if (want.has("标题") && titleIdx != null) addFrom("标题", { as: "标题", from: titleIdx });

  const priceMerge = findPriceMerge(profiles, used);
  if (want.has("售价") && priceMerge) {
    addFrom("售价", { as: "售价", merge: priceMerge, separator: "", coerce: "number" });
  }

  const starIdx = pickBest(profiles, used, (p) => p.starRate * 3);
  if (want.has("评分") && starIdx != null) addFrom("评分", { as: "评分", from: starIdx, coerce: "number" });

  const sizeIdx = pickBest(profiles, used, (p) => {
    if (/种/.test(p.samples.join(" "))) return -1;
    if (p.index > 12 || p.index < 2) return -1;
    if (p.priceFragRate > 0.4 || p.sizeCountRate < 0.4) return -1;
    return p.sizeCountRate * 2.5 + (p.index <= 6 ? 0.35 : 0);
  });
  if (want.has("尺码数") && sizeIdx != null) addFrom("尺码数", { as: "尺码数", from: sizeIdx });

  const reviewIdx = pickBest(profiles, used, (p) => {
    if (p.priceFragRate > 0.5) return -1;
    if (isPriceIntPart(p.samples) && p.avgLen <= 4) return -1;
    return p.reviewTextRate * 3 + (p.avgLen >= 5 ? 0.15 : 0) - p.rankRate;
  });
  if (want.has("评论数") && reviewIdx != null) {
    const samples = profiles[reviewIdx].samples;
    addFrom("评论数", { as: "评论数", from: reviewIdx, coerce: reviewCoerce(samples) });
  }

  const buyIdx = pickBest(profiles, used, (p) => {
    if (p.buyRate < 0.3) return -1;
    return p.buyRate * 3;
  });
  if (want.has("月购买") && buyIdx != null) addFrom("月购买", { as: "月购买", from: buyIdx });

  const marketIdx = pickBest(profiles, used, (p) => {
    if (p.index < 0 || p.index >= width) return -1;
    const tail = width >= 18 && p.index >= width - 10;
    if (p.buyRate > 0.2 || p.reviewTextRate > 0.3) return -1;
    return p.marketRate * 3 + (tail ? 0.4 : 0) + p.priceFragRate * 0.3;
  });
  if (want.has("市场价") && marketIdx != null) {
    addFrom("市场价", { as: "市场价", from: marketIdx, coerce: "number" });
  }

  const shipIdx = pickBest(profiles, used, (p) => {
    if (p.index < 0 || p.index >= width) return -1;
    const tail = width >= 18 && p.index >= width - 4;
    return p.shipRate * 3 + (tail ? 0.5 : 0) + (p.index === width - 1 ? 0.3 : 0);
  });
  if (want.has("配送费") && shipIdx != null) {
    addFrom("配送费", { as: "配送费", from: shipIdx, coerce: "number" });
  }

  if (specs.length < Math.min(3, targetNames.length)) {
    return {
      error:
        "未能从样本推断足够列映射（已匹配 " +
        specs.length +
        "/" +
        targetNames.length +
        "）。请用 inspect_table 的 columns.index 手动 reshape_table op=project，或在消息里写：排名 A(0) · 标题 B(1) …",
    };
  }

  const order = targetNames.filter((n) => specs.some((s) => s.as === n));
  const ordered = order.map((n) => specs.find((s) => s.as === n)!);
  return { columns: ordered, headerless: !!headerless };
}
