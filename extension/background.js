const INGEST = "http://127.0.0.1:8766/api/web-ingest";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "ce-ingest") return;
  fetch(INGEST, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: msg.url || (sender.tab && sender.tab.url) || "",
      rows: msg.rows,
      append: Boolean(msg.append),
      fields: Array.isArray(msg.fields) ? msg.fields : [],
      hasHead: Boolean(msg.hasHead),
      columnLabels: Array.isArray(msg.columnLabels) ? msg.columnLabels : [],
      extractMode: msg.extractMode || "picker",
    }),
  })
    .then((r) => r.json())
    .then((data) => sendResponse(data || { error: "本机后端无响应" }))
    .catch(() => sendResponse({ error: "连不上本机 8766。请先启动 Excel 插件后端。" }));
  return true;
});
