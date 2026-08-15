import { parseExtractIntent } from "./extract-intent";
import { extractSelection } from "./extract";

const CASE_LABEL: Record<string, string> = {
  title: "英文首字母大写",
  lower: "英文小写",
  upper: "英文大写",
  keep: "保持原大小写",
};

/** Run extract_selection without asking the model. Named columns beat the current selection. */
export async function runExtractIntent(
  userText: string,
  onStep?: (msg: string) => void
): Promise<string> {
  const intent = parseExtractIntent(userText);
  const args: string[] = ['caseMode:"' + intent.caseMode + '"', "unique:" + String(intent.unique)];
  if (intent.column) args.push('column:"' + intent.column + '"');
  if (onStep) onStep("🔧 extract_selection({" + args.join(",") + "})");
  const r = await extractSelection({
    column: intent.column,
    caseMode: intent.caseMode,
    unique: intent.unique,
  });
  if (r.unique) {
    return [
      "已去重。新表「" + r.outputSheet + "」共 " + r.rows + " 个唯一" + (r.header || "值") +
        "（原 " + r.sourceRows + " 行" +
        (r.uniqueDropped ? "，去掉重复 " + r.uniqueDropped : "") +
        "）。",
      "源表未改。",
    ].join("\n");
  }
  const extra: string[] = ["去空格"];
  extra.push(CASE_LABEL[r.caseMode] || r.caseMode);
  if (r.blankDropped) extra.push("去掉空行 " + r.blankDropped);
  return [
    "已提取" + (r.header ? "「" + r.header + "」" : "选区") + "（" + r.address + "）并写入新表。",
    "结果表：" + r.outputSheet + "（" + r.rows + " 行，源 " + r.sourceRows + " 行）。",
    extra.join("，") + "。",
    "源表未改。",
  ].join("\n");
}
