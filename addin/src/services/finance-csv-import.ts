import { deleteSheetIfExists } from "../excel/sheet";
import { ensureTable } from "../excel/table";
import { writeToNewSheet } from "../excel/write";
import { setFinanceImportMeta } from "./finance-import-meta";
import { loadConnectorFeed } from "./user-fn";

export const FINANCE_PACK_ID = "cross-border-ecommerce-finance";
export const FINANCE_ORDER_SHEET = "Pack_订单";
export const FINANCE_ADS_SHEET = "Pack_广告";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (!(reader.result instanceof ArrayBuffer)) {
        reject(new Error("读取文件失败"));
        return;
      }
      resolve(arrayBufferToBase64(reader.result));
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsArrayBuffer(file);
  });
}

async function writePackFeedSheet(
  sheetName: string,
  headers: string[],
  rows: (string | number)[][]
): Promise<string> {
  await deleteSheetIfExists(sheetName);
  const grid = [headers, ...rows] as (string | number)[][];
  const written = await writeToNewSheet(sheetName, grid);
  await ensureTable(written, undefined, written);
  return written;
}

/** Import user CSV → connector normalize → Pack_订单 / Pack_广告 tables. */
export async function importFinanceCsvFiles(
  ordersFile: File,
  adsFile: File
): Promise<{ orderSheet: string; adsSheet: string; orderRows: number; adsRows: number }> {
  const [ordersB64, adsB64] = await Promise.all([
    readFileAsBase64(ordersFile),
    readFileAsBase64(adsFile),
  ]);

  const orders = await loadConnectorFeed("orders", FINANCE_PACK_ID, { contentBase64: ordersB64 });
  const ads = await loadConnectorFeed("ads", FINANCE_PACK_ID, { contentBase64: adsB64 });

  const orderSheet = await writePackFeedSheet(
    FINANCE_ORDER_SHEET,
    orders.headers,
    orders.rows as (string | number)[][]
  );
  const adsSheet = await writePackFeedSheet(
    FINANCE_ADS_SHEET,
    ads.headers,
    ads.rows as (string | number)[][]
  );

  setFinanceImportMeta({
    ordersHash: String(orders.meta?.sourceHash || ""),
    adsHash: String(ads.meta?.sourceHash || ""),
    orderRows: orders.rows.length,
    adsRows: ads.rows.length,
  });

  return {
    orderSheet,
    adsSheet,
    orderRows: orders.rows.length,
    adsRows: ads.rows.length,
  };
}
