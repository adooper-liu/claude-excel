/**
 * Turn a JSON payload into a header+rows grid. Generic: no site-specific APIs.
 */
(function (global) {
  const SKIP = /^(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|cookie|authorization|captcha)$/i;
  const LIST_KEYS = ["list", "records", "rows", "items", "content", "result", "data", "datas", "table", "dataset", "entries"];

  function cell(v) {
    if (v == null) return "";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "object") {
      if (Array.isArray(v)) return v.map(cell).filter(Boolean).join("; ");
      try {
        const keys = Object.keys(v).filter((k) => !SKIP.test(k)).slice(0, 6);
        if (!keys.length) return "";
        const bits = keys.map((k) => cell(v[k])).filter(Boolean);
        return bits.join(" / ");
      } catch (e) {
        return "";
      }
    }
    return String(v);
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function rowsFromObjects(arr) {
    const keys = [];
    const seen = {};
    const sample = arr.slice(0, 80);
    for (const row of sample) {
      if (!isPlainObject(row)) continue;
      for (const k of Object.keys(row)) {
        if (seen[k] || SKIP.test(k)) continue;
        seen[k] = 1;
        keys.push(k);
        if (keys.length >= 40) break;
      }
      if (keys.length >= 40) break;
    }
    if (!keys.length) return [];
    const body = arr.slice(0, 500).map((row) => keys.map((k) => (isPlainObject(row) ? cell(row[k]) : "")));
    if (!body.some((r) => r.some(Boolean))) return [];
    return [keys, ...body];
  }

  function scoreGrid(grid) {
    if (!grid || !grid.length) return 0;
    const cols = Math.max.apply(
      null,
      grid.map((r) => (r ? r.length : 0))
    );
    return grid.length * Math.max(cols, 1);
  }

  function findTable(data, depth) {
    if (depth > 6 || data == null) return null;
    if (Array.isArray(data)) {
      const objs = data.filter(isPlainObject);
      if (objs.length >= 2) {
        const grid = rowsFromObjects(objs);
        return { grid: grid, score: scoreGrid(grid) };
      }
      const nested = data.filter(Array.isArray);
      if (nested.length >= 2 && nested[0].length) {
        const grid = nested.slice(0, 500).map((r) => r.map(cell));
        return { grid: grid, score: scoreGrid(grid) };
      }
      return null;
    }
    if (!isPlainObject(data)) return null;
    let best = null;
    const consider = function (v) {
      const hit = findTable(v, depth + 1);
      if (hit && hit.score && (!best || hit.score > best.score)) best = hit;
    };
    for (let i = 0; i < LIST_KEYS.length; i++) {
      const k = LIST_KEYS[i];
      if (k in data) consider(data[k]);
    }
    const vals = Object.keys(data);
    for (let i = 0; i < vals.length; i++) consider(data[vals[i]]);
    return best;
  }

  function gridCols(grid) {
    return Math.max.apply(
      null,
      [0].concat((grid || []).map((r) => (r && r.length) || 0))
    );
  }

  function isUsableGrid(grid) {
    if (!Array.isArray(grid) || grid.length < 2) return false;
    if (gridCols(grid) < 2) return false;
    let filled = 0;
    for (const r of grid) {
      if (!r) continue;
      for (const c of r) {
        if (String(c == null ? "" : c).trim()) filled += 1;
      }
    }
    if (filled < 4) return false;
    return grid.slice(1).some((r) => (r || []).some((c) => String(c == null ? "" : c).trim()));
  }

  function isCaptureGrid(grid) {
    if (!isUsableGrid(grid)) return false;
    const cols = gridCols(grid);
    const rows = grid.length;
    return (cols >= 4 && rows >= 3) || (cols >= 2 && rows >= 15);
  }

  function jsonToGrid(data) {
    const hit = findTable(data, 0);
    return hit && hit.grid && hit.grid.length ? hit.grid : [];
  }

  global.ceJsonToGrid = jsonToGrid;
  global.ceIsUsableGrid = isUsableGrid;
  global.ceIsCaptureGrid = isCaptureGrid;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { jsonToGrid: jsonToGrid, isUsableGrid: isUsableGrid, isCaptureGrid: isCaptureGrid };
  }
})(typeof window !== "undefined" ? window : globalThis);
