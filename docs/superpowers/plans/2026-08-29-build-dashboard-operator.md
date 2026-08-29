---
status: done
---
# build_dashboard 算子（活公式仪表盘组合件）（2026-08-29）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个**参数化核心算子 `build_dashboard`**，一次调用铺出一张「活公式仪表盘」：KPI 卡片 + 各维度 SUMIFS 表 + 可选月序列表 + 最佳值高亮（INDEX/MATCH）+ 图表。所有数字都是公式引用源表，源表一变全盘重算，**没有一行是算好贴死的**。模型只传列名（来自 `inspect`），核心算子用 Office JS 读表头、排布、写公式，**模型不进表体、不写格**。

**Architecture:** 复用仓库既有分层与公式 helper，不新造机制。

- **分层**：纯逻辑进 `dashboard-core.ts`（生成 2D 公式网格，可单测，无 Office JS），Office JS 写格 + 图表进 `dashboard.ts`，与 `pivot.ts`→`pivot-core.ts`、`calculate.ts`→`calculate-core.ts` 同一结构。
- **公式复用** [calculate-core.ts](addin/src/excel/calculate-core.ts) 已导出的 helper：`sumifsFormulaMulti` / `sumifsFormulaSheetMulti` / `colIndexToLetter` / `quoteSheetName` / `lookupFormula` / `structCol` / `thisRowCol` / `excelCriteriaLiteral`。**禁止在 dashboard 里重写一份 SUMIFS/INDEX-MATCH 字符串拼装。**
- **图表复用** [chart.ts](addin/src/excel/chart.ts) 的 `createChart`。
- **注册链五处**（详见 Task 1）：manifest.json → `skill-manifests.ts` → `skill-registry.ts` `HANDLED_TOOLS` → `skill-handlers.ts` `executeHandler` case → `excel/index.ts` export。

**Context / 已核实事实（不要重测）：**

- **注册链实际是五处，CLAUDE.md 写的 `ADDIN_HANDLERS` 已不存在于代码**。当前机制是 [skill-registry.ts](addin/src/services/skill-registry.ts) 的 `HANDLED_TOOLS` Set + [skill-handlers.ts](addin/src/services/skill-handlers.ts) 的 `executeHandler` switch（每个 tool 一个 `case`）。启动时 [skill-loader.ts](addin/src/services/skill-loader.ts) 调 `assertManifestExecutors` 只校验「manifest 的 tool ⊆ HANDLED_TOOLS」，**不自动校验「HANDLED_TOOLS 项有对应 case」**——缺 case 会在运行时静默返回 `Unknown tool`。所以本 plan 明确要求：`HANDLED_TOOLS` 加名 + `executeHandler` 加 case 两处都加，并补一个注册完整性单测兜底。
- 核心 skill 目录：`addin/skills/core/<name>/` 下 `manifest.json` + `SKILL.md`。清单汇总在 `skill-manifests.ts` 的 `CORE_SKILL_MANIFESTS` 数组（按 import 顺序）。
- `create_pivot` 的完整五处落点（可照抄结构）：manifest [pivot/manifest.json](addin/skills/core/pivot/manifest.json)、`skill-manifests.ts:12`、`skill-registry.ts:32`、`skill-handlers.ts:89`、`excel/index.ts:14`。
- 公式 helper 的签名与语义见 `calculate-core.ts`（`sumifsFormulaMulti(table,valueCol,[{column,criteriaRef}])`、`sumifsFormulaSheetMulti(sourceSheet,valueColLetter,[{colLetter,criteriaA1}])`、`lookupFormula`、`colIndexToLetter`、`quoteSheetName`）。
- 图表 `createChart(sheetName, dataRange, chartType, title, seriesBy?, labelRange?, palette?)`；chartType 支持 ColumnClustered/Line/Pie/BarClustered/Area/Scatter。
- 单测：`addin/test/unit/*.test.js`（mocha）；门禁命令 `cd addin && npm run test:unit`（`mocha -r ts-node/register test/unit/*.test.ts test/unit/*.test.js`）、`npm run typecheck`（`tsc --noEmit --skipLibCheck`）、`npm run build`。
- 现有散件：`create_pivot`（真透视）、`calculate_table`（SUMIFS/INDEX-MATCH/算术）、`write_formula`+`fill_range`（裸公式+填充）、`create_chart`。缺的正是「组合件」——把这几样按固定模板编排成一张仪表盘，模型目前要现场几十步手工串。
- CLAUDE.md 纪律（本 plan 的边界来源）：写格唯一通道是核心算子；活公式、合计随源表变、不写死；模型最省 Token、表体不进上下文；算子通用、口令不堆；行业口径不进核心（本算子只做**通用**仪表盘，不内置任何清关/电商口径）。

## Global Constraints

- **新增一个算子 `build_dashboard`，不改任何现有算子的行为**（不动 `create_pivot`/`calculate_table`/`write_formula`/`fill_range`/`create_chart`）。
- **写格只走 Office JS**，由 `dashboard.ts` 一次 `Excel.run` 完成；模型不读表体、不写格、不传值，只传列名/参数。
- **全活公式、零硬编码**：KPI、维度表、占比、最佳值、合计全是公式引用源表；唯一的字面量是「维度取值」标签（如产品名、月份名），不是数字。
- **纯逻辑必须可单测**：公式排布、布局坐标、参数校验都在 `dashboard-core.ts`，无 Office JS；`dashboard.ts` 只做薄写格 + 调 `createChart`。
- **复用不重造**：SUMIFS/INDEX-MATCH/A1 转换一律用 `calculate-core.ts` 现有导出；图表用 `chart.ts`。
- **口径不进核心**：本算子不识别「店铺/HS/口岸」等业务列，只认调用方给的列名；空表头/缺列报错并列出可用列（`calculate-core.requireColumn` 同款语义）。
- **参数校验 fail-visible**：缺 `valueColumns`、缺 `tableName` 且无 `sourceSheet`、维度列/日期列不在表头 → 直接返回带「现有列」清单的 Error（仿 `calculate_table` 的 `requireColumn` 报错风格）。

---

### Task 1: 建 skill 骨架 + 注册链五处

**Files:**
- Create: `addin/skills/core/dashboard/manifest.json`
- Create: `addin/skills/core/dashboard/SKILL.md`
- Modify: `addin/src/services/skill-manifests.ts`（import + `CORE_SKILL_MANIFESTS` 数组加一项）
- Modify: `addin/src/services/skill-registry.ts`（`HANDLED_TOOLS` 加 `"build_dashboard"`）
- Modify: `addin/src/services/skill-handlers.ts`（`executeHandler` 加 `case 'build_dashboard'`，先 dispatch 到 `E.buildDashboard(...)`，实现体在 Task 3 落地）
- Modify: `addin/src/excel/index.ts`（`export { buildDashboard } from './dashboard'`）

**Interfaces:**
- Produces: 一个新核心 tool `build_dashboard`，其 manifest 声明与 HANDLED_TOOLS/case 三处一致，`assertManifestExecutors` 不报缺失。
- Consumes: 无（第一个任务）。

**现状缺陷：** 无 dashboard 组合件；`create_pivot` 只能做真透视，`calculate_table` 只能一次算一种聚合，模型要拼几十步。

- [ ] **Step 1: 建 `dashboard/manifest.json`**，tool 定义如下（字段名即接口契约，实现必须对齐，缺一个参数校验就按 Global Constraints 报错）：

```json
{
  "name": "dashboard",
  "version": "1.0.0",
  "description": "Build a live-formula dashboard: KPI cards + per-dimension SUMIFS tables + optional monthly series + best-of highlight + charts. All cells are formulas referencing the source table.",
  "tools": [
    {
      "name": "build_dashboard",
      "description": "在输出 sheet 铺一张活公式仪表盘（KPI 卡片 + 维度 SUMIFS 表 + 可选月序列表 + 最佳值 INDEX/MATCH 高亮 + 图表），全部公式引用源表，源表变仪表盘自动重算。模型只传列名（来自 inspect），不写格、不进表体。",
      "input_schema": {
        "type": "object",
        "properties": {
          "tableName": { "type": "string", "description": "源 Excel Table 名（先 ensure_table）" },
          "sourceSheet": { "type": "string", "description": "无 tableName 时的源 sheet" },
          "sourceRange": { "type": "string", "description": "无 tableName 时的源 range，含表头" },
          "outputSheet": { "type": "string", "description": "默认「仪表盘」" },
          "valueColumns": { "type": "array", "items": { "type": "string" }, "description": "数值列（如 金额），每个生成一个「合计」KPI；维度表/月序列表按第一个 valueColumn 求和" },
          "countColumn": { "type": "string", "description": "计数列（如 订单号），「笔数」KPI 用 COUNTA；缺省回落第一个维度列" },
          "dimensions": { "type": "array", "items": { "type": "string" }, "description": "维度列（产品/区域/销售/类目），每个生成一张 SUMIFS 表" },
          "dateColumn": { "type": "string", "description": "日期列，生成月序列表（按实际数据月范围）" },
          "kpis": { "type": "array", "items": { "type": "string", "enum": ["total", "count", "avg"] }, "description": "默认 [total, count, avg]；total=每 valueColumn 求和，count=COUNTA(countColumn)，avg=AVERAGE(第一个 valueColumn)" },
          "charts": { "type": "array", "items": { "type": "string", "enum": ["dimension-bar", "month-line", "dimension-pie"] }, "description": "默认：有 dimensions 给 dimension-bar（第一个维度），有 dateColumn 给 month-line" },
          "includeBestOf": { "type": "boolean", "description": "默认 true，生成最佳值高亮（INDEX/MATCH）" }
        },
        "required": ["valueColumns"]
      }
    }
  ]
}
```

- [ ] **Step 2: 建 `dashboard/SKILL.md`**（运行时文档，与代码同步）：写清——(a) 只编排核心算子、模型只传列名；(b) 每个参数对应铺什么公式（对齐 Task 2 的公式模式）；(c) 先 `ensure_table`；(d) 空工作簿/缺列时怎么问澄清（选项式，不替拍板）；(e) 写格只走本算子，禁止模型 `write_to_sheet` 兜底。
- [ ] **Step 3: 注册链三处**：
  - `skill-manifests.ts` 顶部加 `import dashboard from "../../skills/core/dashboard/manifest.json";`，`CORE_SKILL_MANIFESTS` 数组加 `dashboard`（放在 `pivot` 之后）。
  - `skill-registry.ts` 的 `HANDLED_TOOLS` 加 `"build_dashboard"`（按字母序插在 `build` 无关处即可，保持 Set 可读）。
  - `skill-handlers.ts` 加 `case 'build_dashboard': { ... return JSON.stringify(r); }`，内部先只 `const r = await E.buildDashboard({...})`（参数透传清单在 Task 3 定；本 Step 只把 case 挂上并解析入参，保证不 `Unknown tool`）。
  - `excel/index.ts` 加 `export { buildDashboard } from './dashboard';`。
- [ ] **Step 4: 门禁自检**（此刻 `dashboard.ts` 尚未实现，`typecheck` 会因缺 `./dashboard` 报错，属预期；先跑能跑的）：
  - `cd addin && node -e "const r=require('./src/services/skill-registry.ts');"` 不可行（TS），改用：`cd addin && npm run typecheck` 前先确认 `skill-manifests.ts` 语法 OK。实际以 **Task 3 完成后的全量门禁为准**；本 Step 只要求 `git status` 可见上述五处改动、manifest.json 是合法 JSON（`node -e "JSON.parse(require('fs').readFileSync('addin/skills/core/dashboard/manifest.json'))"` → exit 0）。

---

### Task 2: `dashboard-core.ts` 纯逻辑（公式排布，可单测）

**Files:**
- Create: `addin/src/excel/dashboard-core.ts`

**Interfaces:**
- Produces: `planDashboard(headers, params)` → 一个**可预测布局**的结果对象：`{ grid: (string|number|null)[][], charts: [...], report: {...} }`，其中 `grid` 是写格用的 2D 值（含公式字符串），`charts` 是后续调 `createChart` 的参数，`report` 是「写后自查」要断言的预期（KPI 单元格坐标、合计行坐标、占比合计≈1 的断言锚点）。
- Consumes: `calculate-core.ts` 的 helper；`headers`（string[]，来自 Office JS 读的表头，**不进模型**）。

**现状缺陷：** 无。

- [ ] **Step 1: 定布局模板**（固定、确定性，坐标可推导）：
  - 行 1：标题（合并，文本，非公式）
  - 行 2：KPI 区（每个 valueColumn 一个 `=SUMIFS(...)`/`=SUM(...)` 合计；count 一个 `=COUNTA(...)`；avg 一个 `=IFERROR(合计格/笔数格,0)`——**绝对引用 `$列$行` 锚定**，不重写死）
  - 行 3：`月度营收` 区（仅当 `dateColumn` 给）：月份标签 + 每行 `=SUMIFS(valueCol, dateCol, ">="&月起点, dateCol, "<"&下月起点)`，加合计行 `=SUM(...)`
  - 行 4：每个 `dimensions` 一张维度表：维度标签列 + `=SUMIFS(valueCol, dimCol, [@dim])` + 占比列 `=IFERROR(行合计/$总KPI格,0)` + 合计行
  - 行 5（可选 `includeBestOf`）：`=INDEX(维度标签列, MATCH(MAX(合计列), 合计列, 0))` 高亮
- [ ] **Step 2: 实现 `planDashboard`**，用 `calculate-core.ts` 的 `sumifsFormulaMulti`/`sumifsFormulaSheetMulti`/`lookupFormula`/`colIndexToLetter`/`quoteSheetName`/`structCol` 拼公式，**不手拼 SUMIFS 字符串**。参数校验（缺 `valueColumns`、缺表头列、`dimensions`/`dateColumn` 不在 headers）→ throw 带「现有列」清单的 Error（复用/仿 `requireColumn` 语义）。
- [ ] **Step 3: 月份序列**：月标签从**源表实际数据的最小/最大月份**推导（读数据列的 min/max，不硬编码 1-12）；空日期/非法日期跳过并在 `report` 里计数。
- [ ] **Step 4: 写后自查数据**：`report` 里给断言锚点——KPI 各单元格坐标、维度表合计行坐标、占比列坐标、最佳值坐标；供 Task 3 的 `dashboard.ts` 回读比对（不回读对不上就返回 error，**不靠模型眼睛**）。
- [ ] **Step 5: 门禁**：`cd addin && npm run typecheck` → exit 0（本文件独立可编译）。

---

### Task 3: `dashboard.ts` Office JS 写格 + 图表 + 自查

**Files:**
- Create: `addin/src/excel/dashboard.ts`

**Interfaces:**
- Produces: `buildDashboard(opts)` —— `Excel.run` 内：读源表头（`table.getHeaderRowRange().values` 或 range 首行）→ 调 `planDashboard` → `sheet.getRange(...).values = grid` → 逐个 `createChart` → 回读 `report` 断言的单元格核对 → 返回 JSON（sheet 名 + KPI 坐标 + 图表清单 + 自查通过/失败）。写格只用 Office JS，**不读表体回模型**。
- Consumes: `dashboard-core.planDashboard`、`chart.createChart`、`sheet-history.sheetHistory`（新建 sheet 后 push，同 `pivot.ts`）。

**现状缺陷：** 无。

- [ ] **Step 1: 读表头**：优先 `tableName`（`resolveTableName` + `getHeaderRowRange`），无则 `sourceSheet`+`sourceRange`（`parseA1Range` + 首行）。复用 `table-name.ts` 的 `resolveTableName`/`parseA1Range`。
- [ ] **Step 2: 写 grid**：`dest = sheets.add(outputSheet)`，一次性 `dest.getRange(address).values = grid`；合并标题、加粗 KPI 等用既有 `format.ts` 能力（不新造格式函数）。
- [ ] **Step 3: 图表**：按 `charts` 参数逐项 `createChart`（dimension-bar→BarClustered/ColumnClustered，month-line→Line，dimension-pie→Pie），dataRange/labelRange 用 `planDashboard` 给的实际坐标，不要手填。
- [ ] **Step 4: 回读自查**：`dest.getRange(kpiCell).load('formulas')` 等，比对 `report` 断言的公式前缀（如 KPI 格以 `=SUM` 开头、维度表格以 `=SUMIFS` 开头、占比格含绝对引用 `$`）。任一不符 → 返回 error，不静默。
- [ ] **Step 5: `skill-handlers.ts` 的 case 落地**：把 Task 1 挂的空 case 补全为参数解析 + 调 `E.buildDashboard`（参数透传：`tableName/sourceSheet/sourceRange/outputSheet/valueColumns/countColumn/dimensions/dateColumn/kpis/charts/includeBestOf`），返回 `JSON.stringify(r)`；并把 `build_dashboard` 加进 `executeHandler` 末尾 catch 的「失败可重试提示」白名单（现有 `create_pivot`/`calculate_table` 等那一段）。
- [ ] **Step 6: 门禁**：`cd addin && npm run typecheck` → exit 0；`cd addin && npm run build` → exit 0（webpack 能解析新 manifest import 与 `./dashboard`）。

---

### Task 4: 单测 + 注册完整性 + 全量门禁

**Files:**
- Create: `addin/test/unit/dashboard-core.test.js`
- Create: `addin/test/unit/dashboard-registry.test.js`（注册完整性兜底）
- Modify: 无（若发现 `assertManifestExecutors` 语义需补「case 存在」校验，在此 Task 内加，但**不删既有校验**）

**Interfaces:**
- Produces: 两条可跑测试；`test:unit` 全绿。
- Consumes: `dashboard-core.planDashboard`、`CORE_SKILL_MANIFESTS`、`HANDLED_TOOLS`、`skill-handlers` 的 case 覆盖（通过源码文本断言或导出表）。

**现状缺陷：** 缺 case 的 HANDLED_TOOLS 项会静默 `Unknown tool`（已核实事实），没有自动兜底；新增算子无回归保护。

- [ ] **Step 1: `dashboard-core.test.js`**（纯逻辑，仿 `pivot-inputs.test.js`/`calculate-core.test.js`）：固定 headers（如 `['日期','产品','区域','销售','金额','数量','订单号']`）+ 参数，断言：
  - KPI 合计格是 `=SUM...`/`=SUMIFS...`（不是数字）
  - 维度表格以 `=SUMIFS` 开头、占比格含绝对引用 `$`
  - 最佳值格以 `=INDEX` 开头且含 `MATCH`
  - 月序列表（给 `dateColumn`）行数 = 数据实际月跨度
  - 缺列报错消息含「现有列」清单
  - 布局确定性：同一输入两次 `planDashboard` 输出 `grid` 完全相同
- [ ] **Step 2: `dashboard-registry.test.js`**：遍历 `CORE_SKILL_MANIFESTS` 的 tool 名，断言每个 ∈ `HANDLED_TOOLS`，且 `skill-handlers.ts` 源码文本含 `case '<name>'`（读文件或引入一个导出表——实现取清晰可维护者）。这条兜底「缺 case 静默失败」的坑。
- [ ] **Step 3: 全量门禁**：`cd addin && npm run test:unit` → exit 0（新旧全绿）；`cd addin && npm run typecheck` → exit 0；`cd addin && npm run build` → exit 0。

---

## 真机验收（管理员 / Excel 桌面，不代跑）

以下步骤**沙箱/无头环境验不到**，Codex **禁止声称已验证**，只能写「待真机验收」。验收者在 Excel 桌面加载项里做：

1. 打开加载项，造一张带表头的源表（`ensure_table`），含「日期/产品/区域/销售/金额/数量/订单号」几列、若干行。
2. 让默认对话执行「按产品/区域/销售/金额做一张仪表盘」。
3. 核对：输出「仪表盘」sheet 上 KPI 卡片、维度表、月序列表、最佳值高亮、图表都出现，且**改源表一行金额后，KPI/维度/图表数字跟着变**（活公式，不是死数）。
4. 核对：模型没有把表体读进对话、没有 `write_to_sheet` 兜底写死数字。
5. 核对：撤销（任务窗格 ↩）能回退到建表前。

## 收尾

1. `cd addin && npm run typecheck` → exit 0。
2. `cd addin && npm run test:unit` → exit 0（含新增 `dashboard-core.test.js`、`dashboard-registry.test.js`）。
3. `cd addin && npm run build` → exit 0。
4. 提交（任务分支，一条 commit）：`git add addin/skills/core/dashboard addin/src/services/skill-manifests.ts addin/src/services/skill-registry.ts addin/src/services/skill-handlers.ts addin/src/excel/index.ts addin/src/excel/dashboard.ts addin/src/excel/dashboard-core.ts addin/test/unit/dashboard-core.test.js addin/test/unit/dashboard-registry.test.js && git commit -m "feat(skills): build_dashboard 活公式仪表盘组合件（KPI+维度SUMIFS+月序+最佳值+图表，复用 calculate-core/chart）"`。
5. 真机验收段留给管理员跑，Codex 不代跑、不标 done 时声称已验。
6. 全部通过后：按 `docs/coordination.md`，实现完成，review 交回 Claude 对照本 plan 逐粒核对。

## 进度 log

- 2026-08-29 Codex(feat/build-dashboard-operator f8c72b6)：Task1-4 实现完成，typecheck / test:unit(300) / build 全绿。真机验收留给管理员，review 交回 Claude。
