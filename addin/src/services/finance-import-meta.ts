/** In-memory meta from CSV import — consumed by runFinanceIntent when Pack sheets exist. */

export type FinanceImportMeta = {
  ordersHash: string;
  adsHash: string;
  orderRows: number;
  adsRows: number;
};

let pending: FinanceImportMeta | null = null;

export function setFinanceImportMeta(meta: FinanceImportMeta): void {
  pending = meta;
}

export function consumeFinanceImportMeta(): FinanceImportMeta | null {
  const m = pending;
  pending = null;
  return m;
}
