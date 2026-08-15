const PENDING = "http://127.0.0.1:8766/api/web-ingest/pending";
const msgEl = document.getElementById("msg");
const openBtn = document.getElementById("open");
const pingBtn = document.getElementById("ping");
const titleEl = document.getElementById("title");

try {
  const ver = chrome.runtime.getManifest().version;
  if (titleEl && ver) titleEl.textContent = "Claude Excel 取数 v" + ver;
} catch (e) {
  /* ignore */
}

function setMsg(text) {
  if (msgEl) msgEl.textContent = text || "";
}

async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function openPicker() {
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
        if (typeof ceInstallPagePicker === "function") {
          ceInstallPagePicker({ via: "extension", collapsed: false });
        }
      },
    });
    setMsg("已打开取数面板（v" + (chrome.runtime.getManifest().version || "?") + "）。若仍显示旧版本，请到 chrome://extensions 点「重新加载」，再刷新网页。");
    window.close();
  } catch (err) {
    setMsg("无法注入此页（浏览器内置页不行）。请打开普通 https 页面。");
  }
}

async function pingBackend() {
  setMsg("检测中…");
  pingBtn.disabled = true;
  try {
    const r = await fetch(PENDING);
    const data = await r.json();
    if (data && (data.job === null || data.job || data.ok !== false)) {
      setMsg("本机后端正常（8766）。请保持 Excel 任务窗格打开以便落表。");
      return;
    }
    setMsg("后端有响应，但格式异常。请重启 launch.bat。");
  } catch (err) {
    setMsg("连不上 8766。请先启动 Excel 插件后端（launch.bat）。");
  } finally {
    pingBtn.disabled = false;
  }
}

openBtn.addEventListener("click", () => void openPicker());
pingBtn.addEventListener("click", () => void pingBackend());
