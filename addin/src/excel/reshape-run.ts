import { askGenerateSample } from "./intent-guard";
import { inspectWorkbook, inspectTable } from "./inspect";
import { inferProjectColumns, parseProjectTargets } from "./project-infer-core";
import { fetchRecipeProject, fetchRecipeTargets } from "./recipe-project";
import { parseReshapeIntent, pickSourceSheet } from "./reshape-intent";
import { reshapeTable } from "./reshape";
import { ensureTable } from "./table";

const OP_LABEL: Record<string, string> = {
  dedupe: "去重",
  unpivot: "反透视",
  split: "拆列",
  coerce: "类型强制",
  project: "列映射",
};

function pickFetchSheet(
  sheets: Array<{ name: string; range: string | null; rows: number; headers: string[]; tableNames: string[] }>
) {
  const fetch = sheets.filter(function (s) {
    return (/取数_|导入_/i.test(s.name) || /1688|sif|jiimore|极目|ebay|walmart/i.test(s.name)) && s.rows > 1;
  });
  if (fetch.length === 1) return fetch[0];
  if (fetch.length > 1) {
    throw new Error("有多张取数表：" + fetch.map((s) => s.name).join("、") + "。请先只留要整理的那张。");
  }
  return pickSourceSheet(sheets, { op: "project" });
}

/** 规整列：inspect → 推断 columns → reshape_table op=project */
export async function runProjectReshapeIntent(
  userText: string,
  onStep?: (msg: string) => void
): Promise<string> {
  if (onStep) onStep("🔧 inspect_workbook({})");
  const wb = await inspectWorkbook();
  const sheets = wb.sheets.map(function (s) {
    return {
      name: s.name,
      range: s.range,
      rows: s.rows,
      headers: s.headers,
      tableNames: s.tableNames,
    };
  });
  const picked = pickFetchSheet(sheets);
  if (!picked) return askGenerateSample("列映射");
  const targetsFromText = parseProjectTargets(userText);
  const defaultTargets = targetsFromText.length ? [] : await fetchRecipeTargets(picked.name);
  const targets = targetsFromText.length ? targetsFromText : defaultTargets;
  if (!targets.length) {
    throw new Error(
      "请列出目标列名，例如：排名/标题/售价（用 / 或 、 分隔），或把表命名为 取数_amazon.com / 导入_1688选品 等以使用模板。"
    );
  }
  if (onStep) onStep('🔧 ensure_table({"' + picked.name + '"})');
  const table = await ensureTable(
    picked.name,
    picked.range || undefined,
    picked.tableNames[0] || picked.name
  );
  if (onStep) onStep('🔧 inspect_table({tableName:"' + table.name + '"})');
  const info = await inspectTable(table.name);
  const recipeHit = await fetchRecipeProject({ sheetName: picked.name, targets });
  const headerless = recipeHit
    ? recipeHit.headerless
    : !!info.likelyHeaderless || (/取数_/i.test(picked.name) && !/导入_/i.test(picked.name));
  let inferred:
    | { columns: import("./reshape-core").ProjectColumnSpec[]; headerless: boolean }
    | { error: string };
  if (recipeHit) {
    inferred = {
      columns: recipeHit.columns,
      headerless: headerless,
    };
  } else {
    inferred = inferProjectColumns(info.headers, info.sampleRows, targets, headerless, userText);
  }
  if ("error" in inferred) {
    throw new Error(inferred.error);
  }
  const outputSheet = (picked.name + "_规范").slice(0, 31);
  if (onStep) {
    onStep(
      '🔧 reshape_table({tableName:"' +
        table.name +
        '",op:"project",headerless:' +
        inferred.headerless +
        ",columns:[…]})"
    );
  }
  const r = await reshapeTable({
    tableName: table.name,
    op: "project",
    headerless: inferred.headerless,
    columns: inferred.columns,
    outputSheet: outputSheet,
  });
  return [
    "已用 reshape_table 做列映射。",
    "结果表：" + r.outputSheet + "（" + r.rows + " 行，" + inferred.columns.length + " 列）",
    recipeHit ? "列映射来自站点 recipe 模板。" : "",
    headerless ? "首行已作为数据纳入（headerless）。" : "",
    "源表 " + table.name + "（" + picked.name + "）未改。",
    recipeHit ? "" : "若列对不齐，请 inspect_table 看 columns.index 后手动改 project 参数。",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Run inspect → ensure_table → reshape_table without asking the model. */
export async function runReshapeIntent(
  userText: string,
  onStep?: (msg: string) => void
): Promise<string> {
  const intent = parseReshapeIntent(userText);
  if (onStep) onStep("🔧 inspect_workbook({})");
  const wb = await inspectWorkbook();
  const sheets = wb.sheets.map(function (s) {
    return {
      name: s.name,
      range: s.range,
      rows: s.rows,
      headers: s.headers,
      tableNames: s.tableNames,
    };
  });
  const picked = pickSourceSheet(sheets, intent);
  if (!picked) return askGenerateSample(OP_LABEL[intent.op] || "整形");
  if (onStep) onStep('🔧 ensure_table({"' + picked.name + '"})');
  const table = await ensureTable(
    picked.name,
    picked.range || undefined,
    picked.tableNames[0] || picked.name
  );

  if (intent.op === "dedupe" && (!intent.keys || !intent.keys.length)) {
    throw new Error("请说明按哪一列去重，例如：按订单号去重。现有列: " + table.headers.join("、"));
  }
  if (intent.op === "split" && !intent.column) {
    throw new Error("请说明拆哪一列，例如：把标签按逗号拆开。现有列: " + table.headers.join("、"));
  }
  if (intent.op === "coerce" && !intent.column) {
    throw new Error("请说明哪一列转数字，例如：把金额转成数字。现有列: " + table.headers.join("、"));
  }

  if (onStep) {
    onStep(
      '🔧 reshape_table({tableName:"' + table.name + '",op:"' + intent.op + '"})'
    );
  }
  const r = await reshapeTable({
    tableName: table.name,
    op: intent.op,
    keys: intent.keys,
    column: intent.column,
    separator: intent.separator,
    type: intent.type,
  });

  const extra: string[] = [];
  if (r.dropped != null) extra.push("去掉重复 " + r.dropped + " 行");
  if (r.converted != null) extra.push("转换 " + r.converted + " 格");
  if (r.blanked) extra.push("无法转换 " + r.blanked + " 格");

  return [
    "已用 reshape_table 做" + OP_LABEL[r.op] + "。",
    "结果表：" + r.outputSheet + "（" + r.rows + " 行）",
    extra.length ? extra.join("，") + "。" : "",
    "源表 " + table.name + "（" + picked.name + "）未改。",
  ]
    .filter(Boolean)
    .join("\n");
}
