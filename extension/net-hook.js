/**
 * Capture JSON list payloads from the page's own fetch/XHR (MAIN world).
 * Does not read cookies or send bodies to any third party.
 */
(function () {
  if (window.__ceNetHooked) return;
  window.__ceNetHooked = true;
  window.__ceNetTables = [];

  function skipUrl(url) {
    const u = String(url || "");
    if (!u || u.indexOf("chrome-extension:") === 0 || u.indexOf("data:") === 0) return true;
    if (/127\.0\.0\.1:(8765|8766|3000)\b/.test(u) || /localhost:(8765|8766|3000)\b/.test(u)) return true;
    if (/\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map)(\?|$)/i.test(u)) return true;
    if (/flyout|add-to-cart|patc-config|telemetry|analytics|metrics|beacon|csrf|client-state|feature[-_]?flag|i18n|translation|\/rum\b|pixel|navmesh|uedata|autocomplete|completion\/|recommendations\/sp|widget\/|session-token/i.test(u)) return true;
    return false;
  }

  function shortPath(url) {
    try {
      const u = new URL(url, location.href);
      const parts = u.pathname.split("/").filter(Boolean);
      return (parts.slice(-2).join("/") || u.hostname) + u.search.slice(0, 40);
    } catch (e) {
      return String(url || "").slice(-48);
    }
  }

  function remember(url, grid) {
    if (!grid || grid.length < 2) return;
    if (typeof ceIsCaptureGrid === "function" && !ceIsCaptureGrid(grid)) return;
    const cols = Math.max.apply(
      null,
      grid.map((r) => r.length)
    );
    if (cols < 1) return;
    const item = {
      url: String(url || location.href),
      label: shortPath(url) + " · " + grid.length + "行 × " + cols + "列",
      rows: grid.length,
      cols: cols,
      grid: grid,
      at: Date.now(),
    };
    const list = window.__ceNetTables || [];
    const next = list.filter((x) => x.url !== item.url);
    next.unshift(item);
    window.__ceNetTables = next.slice(0, 8);
    try {
      window.dispatchEvent(new CustomEvent("ce-excel-net", { detail: item }));
      window.postMessage({ __ceExcelNet: 1, item: item }, location.origin);
    } catch (e) {
      /* ignore */
    }
  }

  window.addEventListener("ce-excel-net-ask", function () {
    (window.__ceNetTables || []).forEach(function (item) {
      try {
        window.dispatchEvent(new CustomEvent("ce-excel-net", { detail: item }));
      } catch (e) {}
    });
  });

  function fromBody(url, body) {
    if (typeof ceJsonToGrid !== "function") return;
    let data = body;
    if (typeof body === "string") {
      const t = body.replace(/^\uFEFF/, "").trim();
      if (!t || (t[0] !== "{" && t[0] !== "[")) return;
      if (t.length > 1500000) return;
      try {
        data = JSON.parse(t);
      } catch (e) {
        return;
      }
    }
    const grid = typeof ceJsonToGrid === "function" ? ceJsonToGrid(data) : [];
    if (typeof ceIsCaptureGrid === "function" && !ceIsCaptureGrid(grid)) return;
    remember(url, grid);
  }

  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      return origFetch.apply(this, arguments).then(function (res) {
        if (skipUrl(url || (res && res.url))) return res;
        const ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
        if (ct && ct.indexOf("json") < 0 && ct.indexOf("text") < 0 && ct.indexOf("javascript") < 0) return res;
        try {
          res
            .clone()
            .text()
            .then(function (text) {
              fromBody(res.url || url, text);
            })
            .catch(function () {});
        } catch (e) {
          /* ignore */
        }
        return res;
      });
    };
  }

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__ceUrl = url;
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", function () {
      if (skipUrl(this.__ceUrl)) return;
      const ct = this.getResponseHeader && this.getResponseHeader("content-type");
      if (ct && ct.indexOf("json") < 0 && ct.indexOf("text") < 0 && ct.indexOf("javascript") < 0) return;
      let body = this.response;
      if (this.responseType === "" || this.responseType === "text") body = this.responseText;
      fromBody(this.responseURL || this.__ceUrl, body);
    });
    return origSend.apply(this, arguments);
  };
})();
