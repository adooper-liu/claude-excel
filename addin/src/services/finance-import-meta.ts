/** In-memory meta from CSV import — optional provenance for Pack skills (sourceHash). */
export type FinanceImportMeta = {
  ordersHash: string;
  adsHash: string;
  orderRows: number;
  adsRows: number;
};

let lastMeta: FinanceImportMeta | null = null;

export function setFinanceImportMeta(meta: FinanceImportMeta): void {
  lastMeta = meta;
}

/** Read once; clears after consume so a later run does not reuse stale hashes. */
export function consumeFinanceImportMeta(): FinanceImportMeta | null {
  const m = lastMeta;
  lastMeta = null;
  return m;
}
