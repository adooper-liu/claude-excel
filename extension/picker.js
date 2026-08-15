/**
 * In-page picker: click one element to highlight similar items, box multiple regions,
 * write/append from the page so the user does not bounce back to Excel.
 */
(function (global) {
  const PICKER_VER = "0.4.4";
  const BAR_ID = "ce-excel-picker-bar";
  const BOX_ID = "ce-excel-box-root";
  const MARK_ID = "ce-excel-marks";
  const STYLE_ID = "ce-excel-picker-style";
  const UI_SEL = "#ce-excel-picker-bar, #ce-excel-box-root, #ce-excel-banner, #ce-excel-marks";

  function txt(el) {
    return ((el && (el.innerText || el.textContent || el.value)) || "").replace(/\s+/g, " ").trim();
  }

  function isOurUi(el) {
    return !!(el && el.closest && el.closest(UI_SEL));
  }

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

  function filterSimilar(parent, node) {
    const tag = node.tagName;
    let kids = [...parent.children].filter((c) => c.tagName === tag && !isOurUi(c));
    const classes = [...node.classList].filter(usefulClass);
    if (classes.length) {
      const hit = kids.filter((c) => {
        const n = classes.filter((cl) => c.classList.contains(cl)).length;
        return n >= Math.min(2, classes.length) || (classes.length === 1 && n === 1);
      });
      if (hit.length >= 2) kids = hit;
    }
    const h = node.getBoundingClientRect().height;
    if (h > 8 && kids.length > 3) {
      const close = kids.filter((c) => {
        const ch = c.getBoundingClientRect().height;
        return ch > 8 && Math.abs(ch - h) / h < 0.6;
      });
      if (close.length >= 2) kids = close;
    }
    return kids;
  }

  function looksLikeRecords(items) {
    const sample = items.slice(0, 10).map(txt);
    return sample.filter((t) => t.length >= 2).length >= Math.min(2, items.length);
  }

  function similarItems(start) {
    if (!start || start === document.documentElement || start === document.body) return [start];
    const row = start.closest(
      'tr, [role="row"], .ant-table-row, .el-table__row, .vxe-body--row, .kd-table tr'
    );
    if (row && row.parentElement) {
      const sibs = filterSimilar(row.parentElement, row);
      if (sibs.length >= 2 && sibs.length <= 400) return sibs;
    }
    let el = start;
    for (let d = 0; d < 12 && el && el.parentElement; d++) {
      if (/^(HTML|BODY|HEAD)$/.test(el.tagName)) break;
      const sibs = filterSimilar(el.parentElement, el);
      if (sibs.length >= 2 && sibs.length <= 400 && looksLikeRecords(sibs)) return sibs;
      el = el.parentElement;
    }
    return [start];
  }

  function isTableLike(items) {
    if (!items.length) return false;
    const n = items.filter((it) => {
      if (it.tagName === "TR" || it.getAttribute("role") === "row") return true;
      if (it.querySelector(":scope > td, :scope > th")) return true;
      const cn = String(it.className || "");
      return /table-row|el-table__row|ant-table-row|vxe-body--row/.test(cn);
    }).length;
    return n >= Math.min(items.length, 2) && n >= items.length * 0.6;
  }

  function rowFromItem(item) {
    if (!item) return [];
    const direct = [...item.querySelectorAll(":scope > td, :scope > th")].map(txt);
    if (direct.length) return direct;
    const cells = [
      ...item.querySelectorAll('td, th, [role="gridcell"], [role="columnheader"], [role="cell"]'),
    ].map(txt);
    if (cells.length >= 2) return cells;
    const kids = [...item.children].map(txt).filter(Boolean);
    if (kids.length >= 2) return kids;
    const leaves = [];
    const walk = (n) => {
      if (!n || leaves.length > 24) return;
      if (n.nodeType === 3) {
        const t = String(n.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        if (t) leaves.push(t);
        return;
      }
      if (n.nodeType !== 1 || isOurUi(n)) return;
      if (!n.children.length) {
        const t = txt(n);
        if (t) leaves.push(t);
        return;
      }
      [...n.childNodes].forEach(walk);
    };
    walk(item);
    if (leaves.length) return leaves;
    const t = txt(item);
    return t ? [t] : [];
  }

  function relKey(item, el) {
    const tag = (el.tagName || "div").toLowerCase();
    const cls = [...el.classList].filter(usefulClass).slice(0, 2);
    const esc = (c) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(c) : String(c).replace(/[^a-zA-Z0-9_-]/g, "\\$&"));
    const sel = cls.length ? tag + "." + cls.map(esc).join(".") : tag;
    let list = [];
    try {
      list = [...item.querySelectorAll(sel)];
    } catch (e) {
      list = [];
    }
    let i = list.indexOf(el);
    if (i < 0) {
      const parts = [];
      let n = el;
      while (n && n !== item && n.parentElement) {
        const p = n.parentElement;
        const idx = [...p.children].indexOf(n) + 1;
        parts.unshift((n.tagName || "div").toLowerCase() + ":nth-child(" + idx + ")");
        n = p;
      }
      return { sel: parts.join(" > "), i: 0, name: txt(el).slice(0, 24) || tag, path: true };
    }
    return { sel, i, name: txt(el).slice(0, 24) || "列" + (i + 1), path: false };
  }

  function headerName(item, el) {
    const tr = el.closest("tr") || (item && item.tagName === "TR" ? item : null);
    const cell = el.closest("td, th, [role='gridcell'], [role='cell']") || el;
    if (!tr) return "";
    const cells = [...tr.querySelectorAll(":scope > td, :scope > th, :scope > [role='gridcell']")];
    let idx = cells.indexOf(cell);
    if (idx < 0) idx = [...tr.querySelectorAll("td, th")].indexOf(cell);
    if (idx < 0) return "";
    const table = tr.closest("table, .ant-table, .el-table, .vxe-table, .kd-table, [role='grid']");
    if (table) {
      const heads = [
        ...table.querySelectorAll(
          "thead th, .ant-table-thead th, .el-table__header th, .vxe-header--column, [role='columnheader']"
        ),
      ];
      if (heads[idx] && txt(heads[idx])) return txt(heads[idx]).slice(0, 20);
    }
    return "";
  }

  function getField(item, key) {
    if (!item || !key) return null;
    try {
      if (key.path) return item.querySelector(key.sel);
      const all = [...item.querySelectorAll(key.sel)];
      return all[key.i] || all[0] || null;
    } catch (e) {
      return null;
    }
  }

  function gridFromItems(items, fields) {
    if (!items || !items.length) return [];
    if (fields && fields.length) {
      const header = fields.map((f, i) => f.name || "列" + (i + 1));
      const body = items.map((it) => fields.map((f) => txt(getField(it, f))));
      return [header, ...body].filter((r) => r.some(Boolean));
    }
    const rows = items.map(rowFromItem);
    const width = Math.max(0, ...rows.map((r) => r.length));
    const padded = rows
      .map((r) => {
        const x = r.slice();
        while (x.length < width) x.push("");
        return x.slice(0, width);
      })
      .filter((r) => r.some(Boolean));
    const table = items[0] && items[0].closest("table, .ant-table, .el-table, .vxe-table, .kd-table, [role='grid'], [role='table']");
    let head = [];
    if (table) {
      head = [
        ...table.querySelectorAll(
          'thead th, .ant-table-thead th, .el-table__header th, .vxe-header--column, [role="columnheader"]'
        ),
      ]
        .map(txt)
        .filter(Boolean);
    }
    if (head.length && width && Math.abs(head.length - width) <= 2) {
      while (head.length < width) head.push("");
      return [head.slice(0, width), ...padded];
    }
    return padded;
  }

  function collectBoxCells(box) {
    const hit = (r) =>
      r.right > box.left &&
      r.left < box.right &&
      r.bottom > box.top &&
      r.top < box.bottom &&
      r.width > 3 &&
      r.height > 6;
    const sel =
      'td,th,[role="gridcell"],[role="columnheader"],[role="cell"],.ant-table-cell,.el-table td,.el-table th,.vxe-body--column,.vxe-header--column,.kd-table td,.kd-table th';
    const seen = new Set();
    const out = [];
    const add = (el) => {
      if (!el || seen.has(el) || isOurUi(el)) return;
      const r = el.getBoundingClientRect();
      if (!hit(r)) return;
      const t = txt(el);
      if (!t || t.length > 500) return;
      seen.add(el);
      out.push({
        x: r.left + window.scrollX,
        y: r.top + window.scrollY,
        w: r.width,
        h: r.height,
        t,
      });
    };
    document.querySelectorAll(sel).forEach(add);
    if (out.length >= 2) return out.slice(0, 4000);
    const stepY = Math.max(14, Math.min(28, (box.bottom - box.top) / 36));
    const stepX = Math.max(20, Math.min(72, (box.right - box.left) / 24));
    for (let y = box.top + 8; y < box.bottom; y += stepY) {
      for (let x = box.left + 8; x < box.right; x += stepX) {
        const stack = document.elementsFromPoint(x, y) || [];
        const el = stack.find((e) => {
          if (!e || isOurUi(e)) return false;
          const t = txt(e);
          return t && t.length < 80;
        });
        add(el);
      }
    }
    return out.slice(0, 4000);
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

  function ceInstallPagePicker(opts) {
    const options = opts || {};
    const live = document.getElementById(BAR_ID);
    if (
      live &&
      live.getAttribute("data-ce-ver") === PICKER_VER &&
      global.__cePickerCtl &&
      typeof global.__cePickerCtl.setMode === "function"
    ) {
      global.__cePickerClosed = false;
      global.__cePickerVer = PICKER_VER;
      try {
        if (options.collapsed === false && typeof global.__cePickerCtl.expand === "function") {
          global.__cePickerCtl.expand();
        }
        if (options.mode) global.__cePickerCtl.setMode(options.mode);
      } catch (e) {
        /* ignore */
      }
      return "ok";
    }
    if (!global.__cePicker) {
      global.__cePicker = {
        command: null,
        takeCommand: function () {
          const c = this.command;
          this.command = null;
          return c;
        },
      };
    }
    global.__cePickerVer = PICKER_VER;
    global.__cePickerClosed = false;
    const state = {
      mode: options.mode === "box" ? "box" : options.mode === "click" ? "click" : "browse",
      regions: [],
      draft: null,
      locked: null,
      fields: [],
      hover: [],
      written: false,
      collapsed: options.collapsed !== false && options.via === "extension",
      net: [],
    };

    function clearHL() {
      document.querySelectorAll("[data-ce-hl]").forEach((el) => {
        el.style.outline = el.getAttribute("data-ce-prev-outline") || "";
        el.style.background = el.getAttribute("data-ce-prev-bg") || "";
        el.removeAttribute("data-ce-hl");
        el.removeAttribute("data-ce-prev-outline");
        el.removeAttribute("data-ce-prev-bg");
      });
    }

    function hl(els, color) {
      (els || []).forEach((el) => {
        if (!el) return;
        if (!el.getAttribute("data-ce-hl")) {
          el.setAttribute("data-ce-prev-outline", el.style.outline || "");
          el.setAttribute("data-ce-prev-bg", el.style.background || "");
        }
        el.setAttribute("data-ce-hl", "1");
        el.style.outline = "2px solid " + color;
        el.style.outlineOffset = "1px";
      });
    }

    function paint() {
      clearHL();
      if (state.locked && state.locked.length) {
        hl(state.locked, "#16a34a");
        (state.fields || []).forEach((f) => {
          state.locked.forEach((it) => {
            const cell = getField(it, f);
            if (!cell) return;
            if (!cell.getAttribute("data-ce-hl")) {
              cell.setAttribute("data-ce-prev-outline", cell.style.outline || "");
              cell.setAttribute("data-ce-prev-bg", cell.style.background || "");
            }
            cell.setAttribute("data-ce-hl", "1");
            cell.style.outline = "2px solid #f59e0b";
            cell.style.background = "rgba(245,158,11,.28)";
          });
        });
      } else if (state.hover && state.hover.length) {
        hl(state.hover, "#2563eb");
      }
    }

    function setStatus(text) {
      const el = document.getElementById("ce-excel-picker-status");
      if (el) el.textContent = text || "";
    }

    function countLabel() {
      const n = state.regions.length + (state.draft && state.draft.length ? 1 : 0);
      const rows = mergeGrids(allGrids()).length;
      return "已选 " + n + " 块 · " + rows + " 行";
    }

    function allGrids() {
      const g = state.regions.slice();
      if (state.draft && state.draft.length) g.push(state.draft);
      return g;
    }

    function commitDraft() {
      if (state.draft && state.draft.length) state.regions.push(state.draft);
      state.draft = null;
      state.locked = null;
      state.fields = [];
      paint();
    }

    function removeLastMark() {
      const root = document.getElementById(MARK_ID);
      if (!root || !root.lastChild) return;
      root.removeChild(root.lastChild);
      if (!root.childNodes.length) root.remove();
    }

    function canUndo() {
      return !!(state.locked && state.locked.length) || !!(state.draft && state.draft.length) || state.regions.length > 0;
    }

    function undoLast() {
      if (state.locked || (state.draft && state.draft.length)) {
        state.locked = null;
        state.fields = [];
        state.draft = null;
        paint();
        setStatus("已撤销当前点选。");
        refreshBtns();
        return;
      }
      if (state.regions.length) {
        state.regions.pop();
        removeLastMark();
        setStatus(state.regions.length ? "已撤销上一块，还剩 " + state.regions.length + " 块。" : "已撤销全部选区。");
        refreshBtns();
        return;
      }
      setStatus("没有可撤销的选区。");
    }

    function addMark(box) {
      let root = document.getElementById(MARK_ID);
      if (!root) {
        root = document.createElement("div");
        root.id = MARK_ID;
        root.setAttribute("style", "position:absolute;left:0;top:0;z-index:2147483645;pointer-events:none;");
        (document.body || document.documentElement).appendChild(root);
      }
      const mark = document.createElement("div");
      mark.setAttribute(
        "style",
        "position:absolute;left:" +
          box.left +
          "px;top:" +
          box.top +
          "px;width:" +
          (box.right - box.left) +
          "px;height:" +
          (box.bottom - box.top) +
          "px;border:2px solid #2563eb;background:rgba(37,99,235,.08);"
      );
      root.appendChild(mark);
    }

    function plainGrid(grid) {
      return (grid || [])
        .filter((r) => Array.isArray(r))
        .map((r) => r.map((c) => (c == null ? "" : String(c))));
    }

    function usable(grid) {
      if (typeof global.ceIsUsableGrid === "function") return global.ceIsUsableGrid(grid);
      return Array.isArray(grid) && grid.length >= 2 && grid.some((r) => (r || []).some((c) => String(c || "").trim()));
    }

    function bestNet() {
      if (!state.net.length) return null;
      return state.net.reduce((a, b) => (a.rows * a.cols >= b.rows * b.cols ? a : b));
    }

    function sendGrid(grid, append) {
      const rows = plainGrid(grid);
      if (!usable(rows)) {
        setStatus("这张表没有内容。请点接口表上的「写入」，或点选一整列表（至少两行）。");
        return;
      }
      const payload = { type: append ? "append" : "write", grids: [rows], rows, url: location.href, append: !!append };
      const ext =
        options.via === "extension" ||
        (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage);
      if (ext && typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "ce-ingest", url: payload.url, rows: payload.rows, append: payload.append }, (res) => {
          if (chrome.runtime.lastError) {
            setStatus("连不上扩展后台。请确认已加载扩展且本机后端已启动。");
            return;
          }
          if (res && res.error) {
            setStatus(String(res.error));
            return;
          }
          state.written = true;
          setStatus((payload.append ? "已追加 " : "已写入 Excel「") + ((res && res.sheetName) || "") + "」· " + rows.length + " 行。");
          refreshBtns();
        });
        setStatus("正在送到 Excel…");
        return;
      }
      global.__cePicker.command = payload;
      state.written = true;
      setStatus((payload.append ? "已提交追加 " : "已提交写入 ") + rows.length + " 行。任务窗格打开时会落表。");
      refreshBtns();
    }

    function send(type) {
      if (type === "close") {
        global.__cePickerClosed = true;
        global.__cePicker.command = { type: "close" };
        teardown();
        return;
      }
      let rows = mergeGrids(allGrids());
      if (!usable(rows) && state.net.length) {
        const hit = bestNet();
        if (hit && hit.grid) rows = hit.grid;
      }
      sendGrid(rows, type === "append");
    }

    function refreshBtns() {
      const clickBtn = document.getElementById("ce-excel-mode-click");
      const boxBtn = document.getElementById("ce-excel-mode-box");
      const browseBtn = document.getElementById("ce-excel-mode-browse");
      if (clickBtn) clickBtn.className = state.mode === "click" ? "ce-on" : "";
      if (boxBtn) boxBtn.className = state.mode === "box" ? "ce-on" : "";
      if (browseBtn) browseBtn.className = state.mode === "browse" ? "ce-on" : "";
      const bar = document.getElementById(BAR_ID);
      if (bar) bar.classList.toggle("ce-min", !!state.collapsed);
      const undoBtn = document.getElementById("ce-excel-btn-undo");
      if (undoBtn) undoBtn.disabled = !canUndo();
      const badge = document.getElementById("ce-excel-fab-badge");
      if (badge) {
        const n = state.net.length;
        badge.textContent = n ? String(n) : "";
        badge.style.display = n ? "inline-block" : "none";
      }
      renderPreview();
      renderNet();
    }

    function escText(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }

    function splitGrid(grid, fromClick) {
      const rows = plainGrid(grid);
      const r0 = rows[0] || [];
      const r1 = rows[1];
      const hasHead =
        (fromClick && state.fields && state.fields.length > 0) || looksLikeHeaderRow(r0, r1);
      const header = hasHead ? r0.map((c) => String(c).trim() || "列") : r0.map((_, i) => "列" + (i + 1));
      const body = hasHead ? rows.slice(1) : rows;
      return { header, body, raw: rows, hasHead: !!hasHead };
    }

    function renderPreview() {
      const box = document.getElementById("ce-excel-preview");
      if (!box) return;
      const grid = plainGrid(state.draft || mergeGrids(state.regions) || []);
      box.style.display = "block";
      if (!usable(grid)) {
        box.innerHTML =
          '<div class="ce-empty">还没选中内容<div class="ce-hint">点上方「点选」，再点网页列表里的一条；或用「框选」圈表格。列名和前几行会显示在这里。</div></div>';
        return;
      }
      const { header, body, hasHead } = splitGrid(grid, true);
      const n = body.length;
      const source = state.draft
        ? "点选"
        : state.regions.length > 1
          ? "框选 " + state.regions.length + " 块"
          : "框选";
      let chips = "";
      if (hasHead) {
        const shown = header.slice(0, 8);
        chips =
          '<div class="ce-chips">' +
          shown.map((c) => '<span class="ce-chip">' + escText(String(c).slice(0, 14)) + "</span>").join("") +
          (header.length > 8 ? '<span class="ce-chip ce-chip-more">+' + (header.length - 8) + " 列</span>" : "") +
          "</div>";
      }
      const show = body.slice(0, 5);
      let table = '<div class="ce-table-wrap"><table><thead><tr>';
      header.forEach((h, i) => {
        table += "<th>" + escText(String(h || "列" + (i + 1)).slice(0, 16)) + "</th>";
      });
      table += "</tr></thead><tbody>";
      show.forEach((r) => {
        table += "<tr>";
        header.forEach((_, i) => {
          table += "<td>" + escText(String(r[i] || "").slice(0, 24)) + "</td>";
        });
        table += "</tr>";
      });
      table += "</tbody></table></div>";
      table +=
        '<div class="ce-more">预览前 ' +
        show.length +
        " 条" +
        (n > show.length ? "，写入时共 " + n + " 条" : "") +
        (header.length > 6 ? " · 可左右滑动查看全部 " + header.length + " 列" : "") +
        "</div>";
      box.innerHTML =
        '<div class="ce-stat">' +
        n +
        " <span>条 · " +
        header.length +
        " 列 · " +
        source +
        "</span></div>" +
        chips +
        table;
      const write = document.createElement("button");
      write.type = "button";
      write.className = "ce-go";
      write.textContent = "写入这 " + n + " 条到 Excel";
      write.onclick = () => sendGrid(grid, false);
      const append = document.createElement("button");
      append.type = "button";
      append.className = "ce-ghost";
      append.textContent = "追加";
      append.onclick = () => sendGrid(grid, true);
      const undo = document.createElement("button");
      undo.type = "button";
      undo.className = "ce-ghost";
      undo.textContent = "撤销";
      undo.onclick = () => undoLast();
      const btns = document.createElement("div");
      btns.className = "ce-row";
      btns.append(write, append, undo);
      box.appendChild(btns);
    }

    function renderNet() {
      const box = document.getElementById("ce-excel-net-list");
      if (!box) return;
      box.innerHTML = "";
      const list = state.net.filter((item) => item.grid && usable(item.grid));
      if (!list.length) return;
      list.forEach((item) => {
        const row = document.createElement("div");
        row.className = "ce-net";
        const { header, body, hasHead } = splitGrid(item.grid, false);
        const preview = (body[0] || []).filter((c) => String(c).trim()).slice(0, 3).join(" / ");
        const chips = hasHead
          ? header
              .slice(0, 6)
              .map((c) => '<span class="ce-chip">' + escText(String(c).slice(0, 14)) + "</span>")
              .join("")
          : "";
        const lab = document.createElement("div");
        lab.className = "ce-net-lab";
        lab.innerHTML =
          "<b>接口表 · " +
          body.length +
          " 条 × " +
          header.length +
          " 列</b>" +
          (chips ? '<div class="ce-chips">' + chips + "</div>" : "") +
          (preview ? "<span>例：" + escText(preview).slice(0, 48) + "</span>" : "");
        const writeBtn = document.createElement("button");
        writeBtn.type = "button";
        writeBtn.className = "ce-go";
        writeBtn.textContent = "写入这 " + body.length + " 条";
        writeBtn.onclick = () => sendGrid(item.grid, false);
        const appendBtn = document.createElement("button");
        appendBtn.type = "button";
        appendBtn.className = "ce-ghost";
        appendBtn.textContent = "追加";
        appendBtn.onclick = () => sendGrid(item.grid, true);
        row.append(lab, writeBtn, appendBtn);
        box.appendChild(row);
      });
    }

    function onNet(e) {
      const item = e && e.detail;
      if (!item || !item.grid || !usable(item.grid)) return;
      state.net = [item].concat(state.net.filter((x) => x.url !== item.url)).slice(0, 8);
      state.collapsed = false;
      setStatus("捕获到 " + item.rows + " 行 × " + item.cols + " 列。点「写入」送到 Excel。");
      refreshBtns();
    }

    function deepTarget(e) {
      const x = e.clientX;
      const y = e.clientY;
      const stack = document.elementsFromPoint(x, y) || [];
      return stack.find((n) => n && n.nodeType === 1 && !isOurUi(n) && n !== document.documentElement && n !== document.body) || e.target;
    }

    function onMove(e) {
      if (state.mode !== "click") return;
      const el = deepTarget(e);
      if (!el || isOurUi(el)) return;
      if (state.locked && state.locked.length) return;
      state.hover = similarItems(el);
      paint();
      if (state.hover.length >= 2) {
        setStatus("将选中 " + state.hover.length + " 条同类 · 单击锁定 · 可再点下一块");
      } else {
        setStatus("点一条列表/表格行，同类会自动高亮");
      }
    }

    function lockItems(items) {
      if (!items || items.length < 2) {
        setStatus("没找到同类项。请点列表里的一条（不要点按钮或空白）。");
        return;
      }
      state.locked = items;
      state.fields = [];
      state.hover = [];
      state.draft = gridFromItems(items, null);
      paint();
      setStatus("已锁定 " + items.length + " 条。可再点单元格指定列名（黄框是列，绿框是行）。");
      refreshBtns();
    }

    function onClick(e) {
      if (state.mode !== "click") return;
      if (e.button !== 0) return;
      if (isOurUi(e.target)) return;
      const el = deepTarget(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (state.locked && state.locked.length) {
        const inside = state.locked.some((it) => it === el || it.contains(el));
        if (inside) {
          const item = state.locked.find((it) => it === el || it.contains(el)) || state.locked[0];
          const key = relKey(item, el);
          const head = headerName(item, el);
          if (head) key.name = head;
          else if (!key.name || key.name.length > 24) key.name = "列" + (state.fields.length + 1);
          if (!state.fields.some((f) => f.sel === key.sel && f.i === key.i)) {
            state.fields.push(key);
          }
          state.draft = gridFromItems(state.locked, state.fields);
          paint();
          refreshBtns();
          return;
        }
        commitDraft();
      }
      lockItems(similarItems(el));
    }

    function stopBox() {
      const root = document.getElementById(BOX_ID);
      if (root) root.remove();
    }

    function startBox() {
      stopBox();
      const root = document.createElement("div");
      root.id = BOX_ID;
      root.setAttribute(
        "style",
        "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;user-select:none;"
      );
      const veil = document.createElement("div");
      veil.setAttribute("style", "position:absolute;inset:0;background:rgba(15,23,42,.12);");
      const rubber = document.createElement("div");
      rubber.setAttribute(
        "style",
        "position:absolute;border:2px solid #2563eb;background:rgba(37,99,235,.15);display:none;pointer-events:none;"
      );
      root.append(veil, rubber);
      (document.body || document.documentElement).appendChild(root);
      let dragging = false;
      let x0 = 0;
      let y0 = 0;
      const onMoveBox = (ev) => {
        if (!dragging) return;
        const x1 = ev.clientX;
        const y1 = ev.clientY;
        rubber.style.display = "block";
        rubber.style.left = Math.min(x0, x1) + "px";
        rubber.style.top = Math.min(y0, y1) + "px";
        rubber.style.width = Math.abs(x1 - x0) + "px";
        rubber.style.height = Math.abs(y1 - y0) + "px";
      };
      const onUp = (ev) => {
        if (!dragging) return;
        dragging = false;
        window.removeEventListener("mousemove", onMoveBox, true);
        window.removeEventListener("mouseup", onUp, true);
        const box = {
          left: Math.min(x0, ev.clientX),
          top: Math.min(y0, ev.clientY),
          right: Math.max(x0, ev.clientX),
          bottom: Math.max(y0, ev.clientY),
        };
        root.remove();
        if (box.right - box.left < 12 || box.bottom - box.top < 12) {
          setStatus("框太小。按住拖拽再框一块，或切回点选。");
          return;
        }
        const grid = cellsToGrid(collectBoxCells(box));
        if (!grid.length) {
          setStatus("框内没有可读单元格。换一块再框，或改点选。");
          return;
        }
        commitDraft();
        state.regions.push(grid);
        addMark({
          left: box.left + window.scrollX,
          top: box.top + window.scrollY,
          right: box.right + window.scrollX,
          bottom: box.bottom + window.scrollY,
        });
        setStatus("已加入第 " + state.regions.length + " 块。可继续框下一块，或点写入。");
        refreshBtns();
        if (state.mode === "box") startBox();
      };
      root.addEventListener(
        "mousedown",
        (ev) => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          ev.stopPropagation();
          dragging = true;
          x0 = ev.clientX;
          y0 = ev.clientY;
          window.addEventListener("mousemove", onMoveBox, true);
          window.addEventListener("mouseup", onUp, true);
        },
        true
      );
    }

    function setMode(mode) {
      state.mode = mode === "box" ? "box" : mode === "browse" ? "browse" : "click";
      stopBox();
      if (state.mode === "box") {
        clearHL();
        setStatus("按住拖拽框选表格。松开后点「写入选区」。Esc 取消。");
        startBox();
      } else if (state.mode === "browse") {
        clearHL();
        setStatus("现在可以点网页翻页、筛选、搜索。翻完再切回「点选」或「框选」。");
      } else {
        setStatus("点列表里的一条，同类会高亮。Esc 回到「浏览/翻页」。");
      }
      refreshBtns();
    }

    function onKey(e) {
      if (e.key !== "Escape") return;
      if (state.mode === "box") {
        stopBox();
        setMode("click");
        return;
      }
      if (state.locked) {
        state.locked = null;
        state.fields = [];
        state.draft = null;
        paint();
        setStatus("已取消当前锁定。再点一条开始。");
        refreshBtns();
      }
    }

    function mountBar() {
      const stale = document.getElementById(BAR_ID);
      if (stale) stale.remove();
      const staleSt = document.getElementById(STYLE_ID);
      if (staleSt) staleSt.remove();
      const st = document.createElement("style");
      st.id = STYLE_ID;
      st.textContent =
        "#ce-excel-picker-bar{position:fixed;top:64px;right:12px;z-index:2147483647;width:380px;max-width:calc(100vw - 24px);" +
        "background:#fff;color:#0f172a;font:13px/1.45 system-ui,sans-serif;border-radius:12px;padding:0;" +
        "box-shadow:0 12px 40px rgba(15,23,42,.18);border:1px solid #e2e8f0;pointer-events:auto;overflow:hidden;}" +
        "#ce-excel-picker-bar.ce-min{top:auto;right:16px;bottom:16px;width:auto;border-radius:24px;border:0;}" +
        "#ce-excel-picker-bar.ce-min .ce-full{display:none;}" +
        "#ce-excel-picker-bar:not(.ce-min) #ce-excel-fab{display:none;}" +
        "#ce-excel-fab{border:0;background:#2563eb;color:#fff;font:13px/1.2 sans-serif;font-weight:700;padding:10px 14px;border-radius:24px;cursor:pointer;}" +
        "#ce-excel-fab-badge{display:none;margin-left:6px;background:#fbbf24;color:#1e3a5f;border-radius:10px;padding:0 6px;font-size:11px;}" +
        "#ce-excel-picker-bar .ce-head{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:#0f172a;color:#fff;}" +
        "#ce-excel-picker-bar .ce-title{font-weight:700;font-size:14px;}" +
        "#ce-excel-picker-bar .ce-ver{font-size:11px;opacity:.7;margin-left:6px;font-weight:400;}" +
        "#ce-excel-picker-bar .ce-head button{background:transparent;color:#cbd5e1;padding:2px 8px;}" +
        "#ce-excel-picker-bar .ce-head-actions{display:flex;gap:4px;align-items:center;}" +
        "#ce-excel-picker-bar .ce-seg{display:flex;gap:0;padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;}" +
        "#ce-excel-picker-bar .ce-seg button{flex:1;background:#fff;border:1px solid #e2e8f0;border-radius:0;padding:7px 4px;}" +
        "#ce-excel-picker-bar .ce-seg button:first-child{border-radius:6px 0 0 6px;}" +
        "#ce-excel-picker-bar .ce-seg button:last-child{border-radius:0 6px 6px 0;}" +
        "#ce-excel-picker-bar .ce-seg button.ce-on{background:#2563eb;color:#fff;border-color:#2563eb;}" +
        "#ce-excel-picker-bar .ce-body{padding:10px 12px 12px;}" +
        "#ce-excel-picker-bar button{border:0;border-radius:6px;padding:6px 10px;font:12px/1.2 sans-serif;cursor:pointer;background:#e2e8f0;color:#0f172a;}" +
        "#ce-excel-picker-bar button.ce-go{background:#2563eb;color:#fff;font-weight:700;width:100%;padding:10px;margin-top:8px;font-size:13px;}" +
        "#ce-excel-picker-bar button.ce-ghost{background:#fff;border:1px solid #e2e8f0;color:#475569;}" +
        "#ce-excel-picker-bar button:disabled{opacity:.4;cursor:default;}" +
        "#ce-excel-picker-status{color:#64748b;font-size:12px;margin-bottom:8px;}" +
        "#ce-excel-preview .ce-stat{font-size:20px;font-weight:800;letter-spacing:-.02em;margin:4px 0 8px;color:#0f172a;}" +
        "#ce-excel-preview .ce-stat span{font-size:13px;font-weight:600;color:#64748b;margin-left:6px;}" +
        "#ce-excel-preview .ce-chips{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;max-height:52px;overflow:hidden;}" +
        "#ce-excel-preview .ce-chip{background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:650;}" +
        "#ce-excel-preview .ce-chip-more{background:#f1f5f9;color:#64748b;border-color:#e2e8f0;}" +
        "#ce-excel-preview .ce-table-wrap{overflow:auto;max-height:240px;border:1px solid #e2e8f0;border-radius:8px;}" +
        "#ce-excel-preview table{border-collapse:collapse;font-size:11px;min-width:100%;}" +
        "#ce-excel-preview th{background:#f1f5f9;color:#334155;font-weight:700;position:sticky;top:0;z-index:1;}" +
        "#ce-excel-preview th:first-child,#ce-excel-preview td:first-child{position:sticky;left:0;background:#fff;z-index:1;}" +
        "#ce-excel-preview th:first-child{background:#f1f5f9;z-index:2;}" +
        "#ce-excel-preview th,#ce-excel-preview td{border-bottom:1px solid #e2e8f0;padding:6px 8px;text-align:left;min-width:72px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}" +
        "#ce-excel-preview .ce-more{color:#64748b;font-size:11px;margin-top:6px;}" +
        "#ce-excel-preview .ce-empty{color:#94a3b8;padding:18px 8px;text-align:center;font-weight:650;}" +
        "#ce-excel-preview .ce-hint{font-size:12px;font-weight:400;color:#94a3b8;margin-top:6px;line-height:1.45;}" +
        "#ce-excel-preview .ce-row{display:flex;gap:8px;align-items:stretch;margin-top:8px;}" +
        "#ce-excel-preview .ce-row .ce-go{flex:1;width:auto;margin-top:0;}" +
        "#ce-excel-preview .ce-ghost{background:#fff;border:1px solid #e2e8f0;color:#475569;}" +
        "#ce-excel-net-list{max-height:140px;overflow:auto;}" +
        "#ce-excel-net-list .ce-net{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0;}" +
        "#ce-excel-net-list .ce-net-lab{flex:1 1 100%;}" +
        "#ce-excel-net-list .ce-net-lab b{display:block;font-size:12px;}" +
        "#ce-excel-net-list .ce-net-lab span{color:#64748b;font-size:11px;}" +
        "#ce-excel-net-list .ce-chips{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0 4px;}" +
        "#ce-excel-net-list .ce-chip{background:#f1f5f9;color:#334155;border-radius:999px;padding:1px 7px;font-size:10px;}" +
        "#ce-excel-net-list button.ce-go{width:auto;padding:6px 10px;margin-top:0;font-size:12px;}";
      document.documentElement.appendChild(st);
      const bar = document.createElement("div");
      bar.id = BAR_ID;
      bar.setAttribute("data-ce-ver", PICKER_VER);
      bar.innerHTML =
        '<button type="button" id="ce-excel-fab">取数 v' + PICKER_VER + '<span id="ce-excel-fab-badge"></span></button>' +
        '<div class="ce-full">' +
        '<div class="ce-head"><div><span class="ce-title">取数</span><span class="ce-ver">v' + PICKER_VER + "</span></div>" +
        '<div class="ce-head-actions">' +
        '<button type="button" id="ce-excel-btn-undo">撤销</button>' +
        '<button type="button" id="ce-excel-btn-hide">收起</button></div></div>' +
        '<div class="ce-seg">' +
        '<button type="button" id="ce-excel-mode-click">点选</button>' +
        '<button type="button" id="ce-excel-mode-box">框选</button>' +
        '<button type="button" id="ce-excel-mode-browse" class="ce-on">浏览/翻页</button>' +
        "</div>" +
        '<div class="ce-body">' +
        '<div id="ce-excel-picker-status">点「点选」，再点列表里的一条。</div>' +
        '<div id="ce-excel-preview"></div>' +
        '<div id="ce-excel-net-list"></div>' +
        "</div></div>";
      (document.body || document.documentElement).appendChild(bar);
      document.getElementById("ce-excel-fab").onclick = () => {
        state.collapsed = false;
        refreshBtns();
      };
      document.getElementById("ce-excel-btn-hide").onclick = () => {
        state.collapsed = true;
        setMode("browse");
        refreshBtns();
      };
      document.getElementById("ce-excel-btn-undo").onclick = () => undoLast();
      document.getElementById("ce-excel-mode-click").onclick = () => setMode("click");
      document.getElementById("ce-excel-mode-box").onclick = () => setMode("box");
      document.getElementById("ce-excel-mode-browse").onclick = () => setMode("browse");
      refreshBtns();
    }

    function teardown() {
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("ce-excel-net", onNet, false);
      stopBox();
      clearHL();
      const bar = document.getElementById(BAR_ID);
      if (bar) bar.remove();
    }

    if (global.__cePickerCtl && typeof global.__cePickerCtl.teardown === "function") {
      try {
        global.__cePickerCtl.teardown();
      } catch (e) {
        /* ignore */
      }
    }

    mountBar();
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("ce-excel-net", onNet, false);
    window.addEventListener("message", function (e) {
      if (e.origin !== location.origin) return;
      if (e.data && e.data.__ceExcelNet && e.data.item) onNet({ detail: e.data.item });
    });
    try {
      window.dispatchEvent(new CustomEvent("ce-excel-net-ask"));
    } catch (e) {}
    if (Array.isArray(window.__ceNetTables) && window.__ceNetTables.length) {
      state.net = window.__ceNetTables.slice(0, 8);
    }
    global.__cePickerCtl = { teardown, setMode, send, expand: function () { state.collapsed = false; refreshBtns(); } };
    if (options.mode === "box") setMode("box");
    else if (options.mode === "click") setMode("click");
    else setMode("browse");
    return "ok";
  }

  global.ceInstallPagePicker = ceInstallPagePicker;
  global.ceMergeGrids = mergeGrids;
  global.ceLooksLikeHeaderRow = looksLikeHeaderRow;
  global.ceSimilarItems = similarItems;
  global.ceGridFromItems = gridFromItems;
})(typeof window !== "undefined" ? window : globalThis);
