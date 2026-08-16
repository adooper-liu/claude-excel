# Gate 1b：跨境电商业财闭环（CSV → 对账 → 假设 → 透视）

> ERP 是上游水厂；本 Gate **不接** ERP API。connector 用 `csv_local` 产出与 Phase 2 ERP 同构的 `Pack_*` 表。  
> 与 Gate 1a-选品（现有 `/亚马逊选品`）**并行**，不混为一个 demo。

- **分支**：`feat/gate-1b-finance` → 已合 `master`
- **状态**：`done`（2026-08-16 录屏 + 5 行抽查通过）
- **Pack**：`cross-border-ecommerce-finance` + `connector/feeds/*.schema.json`（选品见 `cross-border-ecommerce-research`，**分开安装**）

## 目标

30 分钟内（不含加载项安装）：CSV/fixture → 临时 sheet → 预编排对账 → 参数 sheet → 利润透视 → 审计行；**零手改数据格**。

## 边界 / 不做

- ERP OAuth / 积加领星 API → **Phase 2 v1.1**
- LLM 自由选 tool 拼对账 → 必须 **recipe 预编排**（SKILL.md 固定 steps，调核心算子；**不写 `scripts/*.py`**）
- 核心出现 ERP 名 → 只许 `connector/implementations/`
- 归因窗口（广告点击日 vs 订单成交日，0–7 天）→ **只标注不解决**，写进 `_pack_audit`

## 前置（不计时）

- 加载项 + Pack（含 extensions 同意）已安装
- `fixtures/orders.csv` + `ads.csv`（+ 可选 `inventory.csv`）就位 — **真实卖家脱敏**，见 connector README

## 计时

**起点**：空白簿 + fixture 就绪  
**终点**：透视 sheet 可见 + `_pack_audit` 有本次 run 记录

## 交付 checklist

- [x] `connector/implementations/csv_local`（`user.connector_load_feed`）写出 `Pack_订单` / `Pack_广告`
- [x] 新 Skill `/跨境业财`：固定 steps → `reconcile_tables` → `write_inputs` / `calculate_table` → `create_pivot`（`runFinanceIntent` 预编排）
- [x] 参数 sheet 约定（`假设参数`）
- [x] 写格审计 `_pack_audit`（Phase 1 必做）
- [x] 录屏 + 内部 5 行抽查（2026-08-16：`_pack_audit` · 对账 2/3/2/0 · 假设 B2–B4 · SUMIFS · 透视）

## Gate 1b 通过 → 才做

- Phase 2 ERP connector（换实现，recipe 不动）
- 对外话术：「已接积加/领星…」

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-16 | design | — | — | brief + connector schema 落盘 |
| 2026-08-16 | implement | Cursor | — | csv_local user.* + fixtures + runFinanceIntent + _pack_audit |
| 2026-08-16 | fix | Cursor | — | ① write_inputs；② calculate_table sumifs；Pack 拆分；SUMIFS 工作表引用 |
| 2026-08-16 | verify | 用户 | — | 录屏 + 5 行抽查通过 → 合 master |

## Review notes（Claude Code 填，review 阶段，只读不改代码）

评审：预编排骨架对、安全通、归因标注正确，`user.connector_load_feed` 可取数。后端 100 passed · typecheck 绿。

### 🔴 高（合 master 前必修）

- **① 假设参数未走 `write_inputs`** — `finance-run.ts` `ensureAssumeSheet` 用 `writeToNewSheet` 硬写 B 列，与 SKILL 第 4 步 / `file-structure.md` 管道不符。**修**：建表头后 `writeInputs(ASSUME_SHEET, [{address:"B2",value:7.2}, …])`。

- **② 透视前缺 `calculate_table`** — `finance-run.ts` 对账后直接 `createPivot`，缺 SKILL 第 5 步活公式。**修**：插入 `calculateTable({ op:"sumifs", tableName: recon.outputSheet, groupBy:"left_platform_sku", valueColumn:"left_item_price", outputSheet:"业财利润公式" })`；`createPivot` 改 `tableName: recon.outputSheet`。

### 🟡 低（建议随后）

- **③ `PACK_VERSION` 硬编码** — `finance-run.ts` 应用 installed pack 版本写入 `_pack_audit`。
- **④ `tools-for-request` 未列 `finance-reconciliation`** — 若未来走 LLM 路径会暴露写格工具；预编排短路已覆盖 Gate 录屏。

## Fix log（Cursor 阶段 4）

| 日期 | 阶段 | 负责 | 说明 |
|---|---|---|---|
| 2026-08-16 | fix | Cursor | ① write_inputs B2–B4；② calculate_table sumifs + createPivot tableName |
| 2026-08-16 | fix | Cursor | reconcile ensureTable + T_finance_recon；SUMIFS 改 sheet!col 引用（Office.js） |
| 2026-08-16 | fix | Cursor | Pack 拆分 research/finance；场景包 flyout 安装 UI；tool-name-api 映射 |
