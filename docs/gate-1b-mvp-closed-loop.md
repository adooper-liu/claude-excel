# Gate 1b 最小闭环定义(MVP)

> **状态**:进行中
> **消费者**:Gate 1b 实施者 · Gate 1c 立项者 · 评审
> **关系**(不复制,互补):
> - `docs/tasks/gate-1b-finance-closed-loop.md`(已 done,2026-08-16 录屏 + 5 行抽查)— 历史快照
> - `samples/packs/cross-border-ecommerce-finance/skills/finance-reconciliation/SKILL.md` — 编排步骤(怎么做)
> - 本文 — 当前可交付定义(跑通 = 什么)
> - `docs/architecture-llm-first.md` — 写路径纪律,本文不重复

---

## 1. 最小闭环边界

只跑 4 段。其余 5(税务)/ 6(合规)不进 Gate 1b,留 Gate 1c+ 立项。

| 段 | 工具 | 范围 |
|---|---|---|
| 1 数据接入 | `connector_load_feed`(csv_local)+ PackMenu 导入 | 订单 + 广告;其它不接 |
| 2 对账 | `reconcile_tables`(`matchMode=date_window` `dateWindowDays=7`) | 订单×广告;4 类差异 |
| 3 单 SKU 净利 | `calculate_table` + `write_formula` | 单 SKU × 单月 |
| 4 审计 | `appendPackAudit` | `_pack_audit` 一行 |

---

## 2. 数据流(每步入口/出口)

只写"读完,新表里多了哪一列",不写"做什么":

| 段 | 入口 | 出口(新表) | 多出列 |
|---|---|---|---|
| 1 数据接入 | 空簿 + fixture / 用户导入 | `Pack_订单` / `Pack_广告` | 无(只 raw 进簿) |
| 2 对账 | `Pack_订单` + `Pack_广告` | `业财对账结果` | `__match_status` ∈ {matched, conflict, left_only, right_only} · `__review` ∈ {"" / "需复核"} |
| 3 净利 | `Pack_订单`(`__match_status=matched` 行)+ `假设参数` sheet(B2 汇率 / B3 退款率 / B4 广告占比) | `业财利润公式` | 收入 · 成本 · 广告 · 佣金 · FBA · 退款 · 毛利 · 净利(每 SKU 一行) |
| 4 审计 | 全部 | `_pack_audit` | `pack_id` · `pack_version` · `run_time` · `source_hash` · `review_pending` · `assumption_version` |

---

## 3. 验收三件套

跑通 = 满足**全部**:

- [ ] **终点 1**:`业财利润透视` sheet 可见
- [ ] **终点 2**:`_pack_audit` sheet 有该次 run 记录,字段齐(见 §2 第 4 段)
- [ ] **数对得上**:净利数 = 手工 Excel 算,差异 ≤ 0.01(`reconcile-core` `compareTolerance=0.01`,见 commit `ced067a`)

---

## 4. 0.5% 处置(对照帖 122308)

**出处**:知无不言 帖 122308(2026-08 期,question_id 见 `tmp/wearesellers-scraper/painpoints_clusters.json`)
> "亚马逊平台报送收入与结算报表口径不一致,结算时间和配送时间不同口径计算收入差异约 0.5%"

Gate 1b 工具**不主动算**这个差异,但 MVP 验证时跑一次实测:

- [ ] **准备**:fixture 含「平台报送」+「结算」两套数字的订单表
- [ ] **跑**:`reconcile_tables`,看差异列与"报送"列的比值
- [ ] **跑通**(差异落在 0.5% 量级,±50% 容差):在 `samples/packs/cross-border-ecommerce-finance/knowledge/profit_formula.md` 加一行
  > 「平台报送 vs 结算差异 ≈ 0.5%(社区观察 帖 122308 + Gate 1b MVP 实测)」
- [ ] **跑不通**:降级为「待验证,需更多样本」,SKILL.md 不引用,本节标 `[未通过]`

---

## 5. 🔴 步骤的落点(用户拍板后)

5.5 模式(0110/9810/9610)与 5.6 主体(个体户/小规模/一般纳税人/有限公司)在 Gate 1b **不出现**。

未来进 Gate 1c,拍板后的具体落点:

| 拍板 | 落点 | 影响哪张表 / 哪一列 |
|---|---|---|
| 模式 = 0110/9810/9610 | `假设参数` 加一行 `B5` = 模式 | `calculate_table` 税基公式从 `假设参数!B5` 读 |
| 主体 = 个体户/小规模/一般纳税人/有限公司 | `假设参数` 加一行 `B6` = 主体 | 增值税税率从 `假设参数!B6` 派生 |

工具**不替选**,只提供"拍了改哪一格"的接口。`pack.json` 留口,代码未实现。

---

## 6. 🟢/🟡 双轴(不混)

| 子步 | 工具能跑 | 业务要人判 | 总体 |
|---|---|---|---|
| 数据接入 csv_local | 🟢 | 🟡(选什么 feed) | 🟢 |
| 数据接入 ERP | 🟡(无 erp connector,Phase 2) | 🔴(ERP 选型) | 🔴 |
| 对账 归因窗口 | 🟢 | 🟡(0 / 7 / 14 天) | 🟢 |
| 对账 配对行处理 | 🟢 | 🟡(自动归类 vs 人工) | 🟢 |
| 净利 公式 | 🟢 | 🟡(毛利 / 净利 / 现金流) | 🟢 |
| 净利 佣金率 | 🟢 | 🟡(类目) | 🟢 |
| 净利 退款率 | 🟢 | 🟡(类目) | 🟢 |
| 审计 粒度 | 🟢 | 🟡(每 run / 每改 / 每天) | 🟢 |

---

## 7. Gate 视角

- 抽象拆解(全链路 7 步)= 业务全景,见对话历史(未落仓库,待 Gate 1b 验收后另起)
- **Gate 1b MVP = 本文件 4 段**
- Gate 1b 验收 = §3 三件套
- Gate 1c 立项 = 在抽象拆解基础上加步骤 5(税务),届时另起 brief

---

## 8. 不写在本文件

- 0.5% 的"应该是多少" — 只记**验证动作**,不规定**期望值**
- 模式 / 主体 / 收款通道的"建议" — 工具不替
- 战略评论 — 进 `docs/product-vision.md`
- 实现细节 — 进 `addin/src/excel/finance-run.ts` 与 `SKILL.md`
- 全链路 7 步拆解 — 若要落,另起文件,与本文件不混

---

## 9. 进度 log

| 日期 | 阶段 | 负责 | 说明 |
|---|---|---|---|
| 2026-08-25 | design | Claude | MVP 闭环定义(本文),响应 0.5% / 5-7 步虚胖 / 🔴 落点 三条评审 |

(后续 verify 阶段跑 §3 + §4 后,补 commit hash)
