/// <reference types="@types/office-js" />

import { CHUNK_ROWS, chunkRanges } from "./range-chunk";
import { parseA1Range } from "./table-name";
import { replaceInGrid, type LookIn } from "./find-replace-core";

export type FindReplaceInput = {
  sheetName: string;
  range?: string;
  find: string;
  replace: string;
  matchCase?: boolean;
  completeMatch?: boolean;
  lookIn?: LookIn;
};

export async function findReplace(input: FindReplaceInput): Promise<{
  sheet: string;
  range: string;
  find: string;
  replace: string;
  lookIn: LookIn;
  replaced: number;
  skippedFormulas: number;
}> {
  const sheetName = String(input.sheetName || "").trim();
  const find = String(input.find ?? "");
  if (!sheetName) throw new Error("find_replace 需要 sheetName");
  if (find === "") throw new Error("find_replace 需要 find");
  const lookIn: LookIn = input.lookIn === "formulas" ? "formulas" : "values";

  return Excel.run(async (context) => {
    const sheet = context.workbook.worksheets.getItem(sheetName);
    const addr = input.range && String(input.range).trim() ? parseA1Range(input.range) : "";
    const range = addr ? sheet.getRange(addr) : sheet.getUsedRangeOrNullObject();
    range.load(["address", "rowCount", "columnCount", "rowIndex", "columnIndex", "isNullObject"]);
    await context.sync();
    if ((range as Excel.Range & { isNullObject?: boolean }).isNullObject) {
      return {
        sheet: sheetName,
        range: "",
        find,
        replace: String(input.replace ?? ""),
        lookIn,
        replaced: 0,
        skippedFormulas: 0,
      };
    }
    let replaced = 0;
    let skippedFormulas = 0;
    for (const ch of chunkRanges(range.rowCount, CHUNK_ROWS)) {
      const chunk = range.getRow(ch.start).getBoundingRect(range.getRow(ch.start + ch.count - 1));
      chunk.load(["values", "formulas"]);
      await context.sync();
      const result = replaceInGrid(chunk.values as unknown[][], chunk.formulas as unknown[][], {
        find,
        replace: String(input.replace ?? ""),
        matchCase: input.matchCase === true,
        completeMatch: input.completeMatch === true,
        lookIn,
      });
      skippedFormulas += result.skippedFormulas;
      if (result.replaced === 0) continue;
      replaced += result.replaced;
      if (lookIn === "formulas") {
        chunk.formulas = result.formulas as string[][];
      } else {
        for (let i = 0; i < result.changedCells.length; i++) {
          const cell = result.changedCells[i];
          chunk.getCell(cell.r, cell.c).values = [[cell.value as string | number]];
        }
      }
      await context.sync();
    }
    return {
      sheet: sheetName,
      range: parseA1Range(range.address),
      find,
      replace: String(input.replace ?? ""),
      lookIn,
      replaced,
      skippedFormulas,
    };
  });
}
