/**
 * Pure grid/row helpers for the in-page picker. No DOM.
 * Dual export: browser globals + Node module.exports (see json-table.js).
 */
(function (global) {
  "use strict";

  function usefulClass(c) {
    if (!c || c.length < 2 || c.length > 48) return false;
    if (/^ce-/.test(c)) return false;
    if (/^(active|hover|selected|focus|open|show|hide|hidden|disabled|current|on|off)$/i.test(c)) return false;
    if (/^(is-|has-|ant-click|css-)/i.test(c)) return false;
    if (/^[a-f0-9_-]{8,}$/i.test(c)) return false;
    return true;
  }

  function mergeGrids(grids) {
    const cleaned = [];
    for (const g of grids || []) {
      const rows = (g || [])
        .filter((r) => Array.isArray(r))
        .map((r) => r.map((c) => String(c == null ? "" : c)));
      if (rows.some((r) => r.some(Boolean))) cleaned.push(rows);
    }
    if (!cleaned.length) return [];
    if (cleaned.length === 1) return cleaned[0];
    const width = Math.max(...cleaned[0].map((r) => r.length), 0);
    const head0 = (cleaned[0][0] || []).map((c) => String(c).trim());
    const same = cleaned.every((g) => Math.max(...g.map((r) => r.length), 0) === width);
    if (same && width) {
      const out = [cleaned[0][0].slice()];
      for (const g of cleaned) {
        const head = (g[0] || []).map((c) => String(c).trim());
        const start = head.join("\0") === head0.join("\0") ? 1 : 0;
        out.push(...g.slice(start));
      }
      return out;
    }
    const out = [];
    cleaned.forEach((g, i) => {
      if (i) out.push([]);
      out.push(...g);
    });
    return out;
  }

  function looksLikeHeaderRow(r0, r1) {
    const cells = (r0 || []).map((c) => String(c || "").trim()).filter(Boolean);
    if (!cells.length) return false;
    const noisy = cells.filter((c) =>
      c.length > 22 ||
      /CNY|¥|\$\s?\d|€|市场价|颗星|过去一个月|顾客购买|商品页面|选项:/i.test(c) ||
      /^\+?\d+(\.\d+)?$/.test(c) ||
      /^\d+\.\d{2}$/.test(c)
    ).length;
    if (noisy >= Math.max(2, Math.ceil(cells.length * 0.3))) return false;
    const short = cells.filter((c) => c.length <= 12).length;
    if (short < Math.max(2, Math.ceil(cells.length * 0.5))) return false;
    if (r1) {
      const same = (r0 || []).filter((c, i) => String(c).trim() === String(r1[i] || "").trim()).length;
      if (same > (r0.length || 1) * 0.6) return false;
    }
    return true;
  }

  function cellsToGrid(cells) {
    const raw = (cells || []).filter((c) => c && c.t);
    if (!raw.length) return [];
    const hs = raw.map((c) => Math.max(c.h || 1, 1)).sort((a, b) => a - b);
    const medH = hs[Math.floor(hs.length / 2)];
    const rowTol = Math.max(8, medH * 0.55);
    const ordered = raw.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const c of ordered) {
      const cy = c.y + Math.max(c.h || 1, 1) / 2;
      if (rows.length && Math.abs(cy - rows[rows.length - 1].y) <= rowTol) {
        rows[rows.length - 1].cells.push(c);
        const n = rows[rows.length - 1].cells.length;
        rows[rows.length - 1].y = (rows[rows.length - 1].y * (n - 1) + cy) / n;
      } else {
        rows.push({ y: cy, cells: [c] });
      }
    }
    const xs = raw.map((c) => c.x).sort((a, b) => a - b);
    const ws = raw.map((c) => Math.max(c.w || 1, 1)).sort((a, b) => a - b);
    const colTol = Math.max(12, ws[Math.floor(ws.length / 2)] * 0.35);
    const clusters = [];
    for (const x of xs) {
      if (clusters.length && x - clusters[clusters.length - 1][clusters[clusters.length - 1].length - 1] <= colTol) {
        clusters[clusters.length - 1].push(x);
      } else clusters.push([x]);
    }
    const colX = clusters.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
    const grid = [];
    for (const rg of rows) {
      const row = colX.map(() => "");
      rg.cells
        .slice()
        .sort((a, b) => a.x - b.x)
        .forEach((c) => {
          let idx = 0;
          let best = Infinity;
          colX.forEach((x, j) => {
            const d = Math.abs(c.x - x);
            if (d < best) {
              best = d;
              idx = j;
            }
          });
          const t = String(c.t || "");
          if (!row[idx] || t.length > row[idx].length) row[idx] = t;
        });
      if (row.some(Boolean)) grid.push(row);
    }
    return grid;
  }

  global.ceUsefulClass = usefulClass;
  global.ceMergeGrids = mergeGrids;
  global.ceLooksLikeHeaderRow = looksLikeHeaderRow;
  global.ceCellsToGrid = cellsToGrid;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { usefulClass, mergeGrids, looksLikeHeaderRow, cellsToGrid };
  }
})(typeof window !== "undefined" ? window : globalThis);
