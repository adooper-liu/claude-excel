/// <reference types="@types/office-js" />

import { sheetHistory } from "./sheet-history";

/** 当前工作簿的稳定键：Office 文件属性 url+title 的简单哈希（挪文件/改名会换键 → 笔记按需重学，保守不误用）。 */
export function workbookFileKey(): Promise<string> {
  return new Promise((resolve) => {
    try {
      Office.context.document.getFilePropertiesAsync(function (result) {
        const props = (result && result.value ? result.value : {}) as {
          url?: string;
          title?: string;
        };
        const url = String(props.url || '');
        const title = String(props.title || '');
        let h = 0;
        const s = url + '|' + title;
        for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
        resolve(h.toString(36));
      });
    } catch {
      resolve('unknown');
    }
  });
}

export async function getSheetNames(): Promise<string[]> {
  return Excel.run(async (context) => {
    const sheets = context.workbook.worksheets; sheets.load('items/name'); await context.sync();
    return sheets.items.map(s => s.name);
  });
}

export async function setActiveSheet(sheetName: string): Promise<void> {
  await Excel.run(async (context) => { context.workbook.worksheets.getItem(sheetName).activate(); await context.sync(); });
}

export async function deleteSheetIfExists(sheetName: string): Promise<void> {
  const names = await getSheetNames();
  if (!names.includes(sheetName) || names.length <= 1) return;
  await Excel.run(async (context) => {
    context.workbook.worksheets.getItem(sheetName).delete();
    await context.sync();
  });
}

export async function undoLastResultSheet(): Promise<string> {
  const item = sheetHistory.pop();
  if (!item) throw new Error("没有可撤销的结果表");
  return applyUndo(item);
}

export async function undoResultSheet(sheetName: string): Promise<string> {
  const item = sheetHistory.remove(sheetName);
  if (!item) throw new Error('没有「' + sheetName + '」这条历史');
  return applyUndo(item);
}

async function applyUndo(item: { sheet: string; previous: string }): Promise<string> {
  try {
    const names = await getSheetNames();
    if (names.includes(item.sheet)) {
      if (names.length <= 1) throw new Error("不能删除工作簿中的最后一个工作表");
      await Excel.run(async (context) => {
        context.workbook.worksheets.getItem(item.sheet).delete();
        await context.sync();
      });
    }
    try {
      await setActiveSheet(item.previous);
    } catch {
      /* previous sheet may already be gone */
    }
    return item.sheet;
  } catch (err) {
    sheetHistory.push(item.sheet, item.previous);
    throw err;
  }
}
