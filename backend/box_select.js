() => {
  const ROOT_ID = "ce-excel-box-root";
  const MARK_ID = "ce-excel-box-mark";
  const old = document.getElementById(ROOT_ID);
  if (old) old.remove();
  const oldMark = document.getElementById(MARK_ID);
  if (oldMark) oldMark.remove();

  window.__ceManual = { pending: true, cancelled: false, cells: [], box: null };

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute(
    "style",
    "position:fixed;inset:0;z-index:2147483646;cursor:crosshair;user-select:none;"
  );
  const veil = document.createElement("div");
  veil.setAttribute("style", "position:absolute;inset:0;background:rgba(15,23,42,.18);");
  const rubber = document.createElement("div");
  rubber.setAttribute(
    "style",
    "position:absolute;border:2px solid #2563eb;background:rgba(37,99,235,.15);display:none;pointer-events:none;"
  );
  const hint = document.createElement("div");
  hint.setAttribute(
    "style",
    "position:absolute;top:12px;left:50%;transform:translateX(-50%);padding:8px 12px;background:#1e3a5f;color:#fff;font:13px/1.4 sans-serif;border-radius:6px;pointer-events:none;white-space:nowrap;"
  );
  hint.textContent = "按住拖拽框选表格区域，松开即选定 · Esc 取消";
  root.append(veil, rubber, hint);
  (document.body || document.documentElement).appendChild(root);

  const collectCells = (box) => {
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
      if (!el || seen.has(el) || el.closest("#" + ROOT_ID + ",#" + MARK_ID + ",#ce-excel-banner")) return;
      const r = el.getBoundingClientRect();
      if (!hit(r)) return;
      const t = ((el.innerText || el.value || "") + "").replace(/\s+/g, " ").trim();
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
          if (!e || e === root || e.closest("#" + ROOT_ID + ",#" + MARK_ID + ",#ce-excel-banner")) return false;
          const t = ((e.innerText || e.value || "") + "").replace(/\s+/g, " ").trim();
          return t && t.length < 80;
        });
        add(el);
      }
    }
    return out.slice(0, 4000);
  };

  const finish = (clientBox) => {
    root.remove();
    const cells = collectCells(clientBox);
    const pageBox = {
      left: clientBox.left + window.scrollX,
      top: clientBox.top + window.scrollY,
      right: clientBox.right + window.scrollX,
      bottom: clientBox.bottom + window.scrollY,
    };
    const mark = document.createElement("div");
    mark.id = MARK_ID;
    mark.setAttribute(
      "style",
      "position:absolute;left:" +
        pageBox.left +
        "px;top:" +
        pageBox.top +
        "px;width:" +
        (pageBox.right - pageBox.left) +
        "px;height:" +
        (pageBox.bottom - pageBox.top) +
        "px;border:2px solid #2563eb;background:rgba(37,99,235,.06);pointer-events:none;z-index:2147483645;"
    );
    (document.body || document.documentElement).appendChild(mark);
    window.__ceManual = { pending: false, cancelled: false, cells, box: pageBox };
  };

  let dragging = false;
  let x0 = 0;
  let y0 = 0;
  const onMove = (e) => {
    if (!dragging) return;
    const x1 = e.clientX;
    const y1 = e.clientY;
    const left = Math.min(x0, x1);
    const top = Math.min(y0, y1);
    rubber.style.display = "block";
    rubber.style.left = left + "px";
    rubber.style.top = top + "px";
    rubber.style.width = Math.abs(x1 - x0) + "px";
    rubber.style.height = Math.abs(y1 - y0) + "px";
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    const x1 = e.clientX;
    const y1 = e.clientY;
    const box = {
      left: Math.min(x0, x1),
      top: Math.min(y0, y1),
      right: Math.max(x0, x1),
      bottom: Math.max(y0, y1),
    };
    if (box.right - box.left < 12 || box.bottom - box.top < 12) {
      window.__ceManual = { pending: false, cancelled: true, cells: [], box: null };
      root.remove();
      return;
    }
    finish(box);
  };
  root.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      x0 = e.clientX;
      y0 = e.clientY;
      window.addEventListener("mousemove", onMove, true);
      window.addEventListener("mouseup", onUp, true);
    },
    true
  );
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    root.remove();
    window.__ceManual = { pending: false, cancelled: true, cells: [], box: null };
  };
  window.addEventListener("keydown", onKey, true);
  return "ok";
}
