const INGEST = "http://127.0.0.1:8766/api/web-ingest";

const listEl = document.getElementById("list");
const msgEl = document.getElementById("msg");
const scanBtn = document.getElementById("scan");
const writeBtn = document.getElementById("write");
const appendBtn = document.getElementById("append");
const pickBtn = document.getElementById("pick");

let grids = [];
let picked = 0;
let pageUrl = "";

function setMsg(text) {
  msgEl.textContent = text || "";
}

function render() {
  listEl.innerHTML = "";
  grids.forEach((g, i) => {
    const cols = Math.max(...g.map((r) => r.length), 0);
    const preview = (g[0] || []).filter(Boolean).slice(0, 4).join(" / ");
    const label = document.createElement("label");
    if (i === picked) label.className = "is-on";
    label.innerHTML =
      '<input type="radio" name="g" ' +
      (i === picked ? "checked " : "") +
      "/><span>表" +
      (i + 1) +
      " · " +
      g.length +
      "行 × " +
      cols +
      "列" +
      (preview ? " · " + preview : "") +
      "</span>";
    label.querySelector("input").addEventListener("change", () => {
      picked = i;
      render();
    });
    listEl.appendChild(label);
  });
  writeBtn.disabled = !grids.length;
  appendBtn.disabled = !grids.length;
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function startPick() {
  setMsg("");
  const tab = await currentTab();
  if (!tab || tab.id == null) {
    setMsg("没有当前标签页。");
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["picker.js"] });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof ceInstallPagePicker === "function") ceInstallPagePicker({ via: "extension" });
      },
    });
    window.close();
  } catch (err) {
    setMsg("无法注入此页（浏览器内置页不行）。请打开普通 https 页面。");
  }
}

async function scan() {
  setMsg("");
  const tab = await currentTab();
  if (!tab || tab.id == null) {
    setMsg("没有当前标签页。");
    return;
  }
  pageUrl = tab.url || "";
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
    const out = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (typeof ceExtractGrids === "function" ? ceExtractGrids() : []),
    });
    grids = (out && out[0] && out[0].result) || [];
    picked = 0;
    render();
    if (!grids.length) setMsg("当前页没扫到表。改用「开始点选」，或等数据刷完再扫。");
  } catch (err) {
    setMsg("无法读取此页（浏览器内置页不行）。请打开普通 https 页面。");
  }
}

async function send(append) {
  if (!grids[picked]) return;
  setMsg("");
  writeBtn.disabled = true;
  appendBtn.disabled = true;
  try {
    const r = await fetch(INGEST, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: pageUrl, rows: grids[picked], append: Boolean(append) }),
    });
    const data = await r.json();
    if (data && data.error) {
      setMsg(String(data.error) + " 请确认本机后端已启动。");
      return;
    }
    setMsg((append ? "已追加到队列「" : "已送到 Excel「") + (data.sheetName || "") + "」。打开任务窗格即写入。");
  } catch (err) {
    setMsg("连不上本机 8766。请先启动 Excel 插件后端。");
  } finally {
    writeBtn.disabled = !grids.length;
    appendBtn.disabled = !grids.length;
  }
}

pickBtn.addEventListener("click", () => void startPick());
scanBtn.addEventListener("click", () => void scan());
writeBtn.addEventListener("click", () => void send(false));
appendBtn.addEventListener("click", () => void send(true));
