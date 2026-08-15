/** In-grid find/replace. Formula cells are skipped when lookIn=values. */

export type LookIn = "values" | "formulas";

export type ReplaceOpts = {
  find: string;
  replace: string;
  matchCase?: boolean;
  completeMatch?: boolean;
  lookIn?: LookIn;
};

function cellText(v: unknown): string {
  if (v == null) return "";
  return String(v);
}

function isFormula(v: unknown): boolean {
  return typeof v === "string" && v.startsWith("=");
}

function matches(text: string, find: string, opts: ReplaceOpts): boolean {
  if (find === "" && !opts.completeMatch) return false;
  if (opts.completeMatch) {
    return opts.matchCase ? text === find : text.toLowerCase() === find.toLowerCase();
  }
  if (opts.matchCase) return text.indexOf(find) >= 0;
  return text.toLowerCase().indexOf(find.toLowerCase()) >= 0;
}

function swapped(text: string, find: string, repl: string, matchCase: boolean): string {
  if (matchCase) return text.split(find).join(repl);
  const lowerFind = find.toLowerCase();
  let out = "";
  let i = 0;
  const src = text;
  const lower = src.toLowerCase();
  while (i < src.length) {
    const at = lower.indexOf(lowerFind, i);
    if (at < 0) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, at) + repl;
    i = at + find.length;
  }
  return out;
}

export type GridReplaceResult = {
  values: unknown[][];
  formulas: unknown[][];
  replaced: number;
  skippedFormulas: number;
  changedCells: Array<{ r: number; c: number; value?: unknown; formula?: unknown }>;
};

export function replaceInGrid(
  values: unknown[][],
  formulas: unknown[][],
  opts: ReplaceOpts
): GridReplaceResult {
  const find = String(opts.find ?? "");
  const repl = String(opts.replace ?? "");
  const lookIn: LookIn = opts.lookIn === "formulas" ? "formulas" : "values";
  const vals = (values || []).map(function (row) {
    return (row || []).slice();
  });
  const forms = (formulas || []).map(function (row) {
    return (row || []).slice();
  });
  let replaced = 0;
  let skippedFormulas = 0;
  const changedCells: GridReplaceResult["changedCells"] = [];
  const rows = Math.max(vals.length, forms.length);
  for (let r = 0; r < rows; r++) {
    const vrow = vals[r] || [];
    const frow = forms[r] || [];
    const cols = Math.max(vrow.length, frow.length);
    if (!vals[r]) vals[r] = vrow;
    if (!forms[r]) forms[r] = frow;
    for (let c = 0; c < cols; c++) {
      const formula = frow[c];
      if (lookIn === "values") {
        if (isFormula(formula)) {
          skippedFormulas += 1;
          continue;
        }
        const text = cellText(vrow[c]);
        if (!matches(text, find, opts)) continue;
        const next = opts.completeMatch ? repl : swapped(text, find, repl, !!opts.matchCase);
        if (next === text) continue;
        vals[r][c] = next;
        replaced += 1;
        changedCells.push({ r, c, value: next });
      } else {
        const text = cellText(formula);
        if (!text) continue;
        if (!matches(text, find, opts)) continue;
        const next = opts.completeMatch ? repl : swapped(text, find, repl, !!opts.matchCase);
        if (next === text) continue;
        forms[r][c] = next;
        replaced += 1;
        changedCells.push({ r, c, formula: next });
      }
    }
  }
  return { values: vals, formulas: forms, replaced, skippedFormulas, changedCells };
}
