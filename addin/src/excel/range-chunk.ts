/** Chunked Office.js I/O helpers — inspect samples, 万行 reads/writes, column formula runs. */

export const INSPECT_SAMPLE_ROWS = 5;
export const CHUNK_ROWS = 2000;
/** Skip Excel Table on huge result sheets — tables.add on 十万+ rows is too slow. */
export const TABLE_ADD_MAX_ROWS = 50000;
/** Full-grid readTable / unpivot / reconcile stay in JS; above this, throw and use streaming ops. */
export const FULL_LOAD_MAX_CELLS = 2000000;

export type Cell = string | number | boolean | null;

export type ChunkRange = { start: number; count: number };

export type FormulaRun = {
  col: number;
  startRow: number;
  formulas: string[][];
};

export function inspectSampleRows(dataRows: number): number {
  const n = Number(dataRows) || 0;
  if (n <= 0) return 0;
  return Math.min(INSPECT_SAMPLE_ROWS, n);
}

export function chunkRanges(totalRows: number, chunkSize: number): ChunkRange[] {
  const total = Math.max(0, Number(totalRows) || 0);
  const size = Math.max(1, Number(chunkSize) || 1);
  const out: ChunkRange[] = [];
  for (let start = 0; start < total; start += size) {
    out.push({ start, count: Math.min(size, total - start) });
  }
  return out;
}

export function isFormulaCell(cell: Cell): boolean {
  return typeof cell === "string" && cell.startsWith("=");
}

export function valuesWithoutFormulas(grid: Cell[][]): (string | number)[][] {
  return (grid || []).map((row) =>
    (row || []).map((c) => {
      if (isFormulaCell(c)) return "";
      if (c === null || c === undefined) return "";
      return c as string | number;
    })
  );
}

export function formulaColumnRuns(grid: Cell[][]): FormulaRun[] {
  const rows = grid || [];
  if (rows.length < 2) return [];
  const colCount = rows[0].length;
  const runs: FormulaRun[] = [];
  for (let c = 0; c < colCount; c++) {
    let r = 1;
    while (r < rows.length) {
      if (!isFormulaCell(rows[r][c])) {
        r += 1;
        continue;
      }
      const startRow = r;
      const formulas: string[][] = [];
      while (r < rows.length && isFormulaCell(rows[r][c])) {
        formulas.push([rows[r][c] as string]);
        r += 1;
      }
      runs.push({ col: c, startRow, formulas });
    }
  }
  return runs;
}
