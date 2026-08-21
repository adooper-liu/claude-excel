# Gate 1b 场景 Pack 化：把行业编排从核心执行器迁回 Pack

> 状态：进行中（P0+P1+P2 完成 · P3 验收待做）
> 日期：2026-08-21
> 上游：`gate-1b-value-implementation.md`（价值实施 brief）——**本方案应先于/合并其实施**，避免 TS 预编排上做四个能力后再返工迁移
> 目的：用户选择「真正 Pack 化」——让跨境业财场景**可装可卸、改口径不发版**，回归 `docs/user-packs.md` 的架构本意。
>
> 进度 log：
> - 2026-08-21 Cursor：P0 `append_pack_audit` 注册为核心算子（manifest + HANDLED_TOOLS + handler；schema 增 assumptionSnapshot/matchRate）；单测绿 + typecheck 绿。P1 `finance-reconciliation/SKILL.md` 重写为强模板编排手册（附录 A/B/C）并与 profit_formula.md §四 对齐 G6。
> - 2026-08-21 Cursor：P2 拆 TS — 删 `finance-run.ts` / `isFinanceRequest` / App `/跨境业财` 预抢答 / `run_flow(finance)`；flows manifest 去 finance；新增 `finance-skill-handbook.test.js`；运行时文档同步。
---

## 0. 现状诊断：三处偏离设计本意

`user-packs.md` §1 明确：**Skill（SKILL.md）是编排层**——「编排步骤、口径选项；**只调用**核心算子」，Prompt-only，不引入新机制。§6 混线禁令：「行业不进核心」。

但 Gate 1b 的实际实现偏离了：

| # | 偏离点 | 位置 | 违反 |
|---|---|---|---|
| 1 | **行业场景编成 TS 代码**：7 步预编排（connector→ensure→reconcile→假设→SUMIFS→pivot→audit）226 行命令式代码 | `addin/src/excel/finance-run.ts` | 编排应在 SKILL.md，不在核心代码 |
| 2 | **行业 flow 注册进核心执行器**：`run_flow` 的 flows 映射加了 `finance` 分支，与 reconcile/calculate 等**通用** flow 并列 | `addin/src/services/skill-handlers.ts` | §6「行业不进核心」 |
| 3 | **意图守卫硬编码正则**：`isFinanceRequest`（/跨境业财|业财对账…/）编译进 addin | `finance-run.ts:25` | 意图路由应由 SKILL.md description/slash 承担 |

**代价**：改一个净利公式口径 → 改 TS → typecheck + 发版加载项；场景不可卸载；每个新场景都要往核心加一个 flow（熵增）。

---

## 1. 机制盘点（本轮代码确认，2026-08-21）

Pack 化的管道**本来就通**，只缺一块：

| 机制 | 现状 | 结论 |
|---|---|---|
| 编排所需算子 | `ensure_table / reconcile_tables / calculate_table / create_pivot / write_inputs / write_to_sheet / write_formula / conditional_format` 全部在 `HANDLED_TOOLS`（skill-registry.ts） | ✅ LLM 已可逐步调用（value brief §6 的三个依赖确认项**全部已有工具支撑**） |
| SKILL.md 注入 | `skill-md.ts` 解析 frontmatter+body，Prompt-only；已装 skill 引导 LLM（遗留 product-info-search 即此模式） | ✅ 机制存在且已验证 |
| connector feed | `connector_load_feed` 走 `user.*`（user-fn.ts + 信任门） | ✅ Pack 自带 |
| **审计写入** | `appendPackAudit` 只被 finance-run.ts 直接 import，**无工具入口，LLM 调不了** | ❌ **唯一硬缺口** |
| 意图路由 | SKILL.md 的 slash（如 `/跨境业财`）+ description | ✅ 可承接（删 isFinanceRequest） |

---

## 2. 方案对比

| 方案 | 内容 | 评价 |
|---|---|---|
| **1. 纯 LLM 编排**（推荐） | SKILL.md 写成强模板编排手册，LLM 按步骤调已有算子；删 TS 预编排；核心只补一个**通用**审计算子 | ✅ 完全符合已定架构（「Pack 是组织层不是新机制」）；零新机制；行业逻辑全出核心 |
| 2. 声明式 pipeline 引擎 | pack.json 加 `steps[]` 字段 + addin 加通用 pipeline 执行器 | ❌ 引入新执行机制，与 user-packs.md「不引入新机制」的已定决策冲突；一次性投入大 |
| 3. run_flow 数据驱动 | 保留 run_flow，flow 定义从 Pack 声明读取 | ⚠️ 折中：改动最小，但「flow 名注册」仍在核心，不彻底；且等于变相实现方案 2 的引擎 |

**推荐方案 1**。当初做 TS 预编排的真实原因是验收期求稳（LLM 编排不确定），不是架构必然——用 §4 的强模板 + 审计可回放对冲。

---

## 3. 目标形态（Pack 化后的跨境业财包）

```
samples/packs/cross-border-ecommerce-finance/
  pack.json                     # gate: "1b"，skills/extensions/connector 声明
  skills/finance-reconciliation/SKILL.md   # ⬇ 编排手册（核心迁出物）
  knowledge/profit_formula.md               # 口径（已是权威）
  extensions/…                              # user.*（不变）
  connector/…                               # CSV fixture（不变）
```

**SKILL.md 结构**（把 finance-run.ts 翻译成手册，步骤=工具调用模板）：

```markdown
## 编排（严格按序执行，每步用上一步返回值填参）
1. user.connector_load_feed({feed:"orders"}) → 同 "ads"（若 sheet 已存在则跳过）
2. ensure_table({sheet:订单表}) × 2
3. reconcile_tables({keys:["platform_sku","biz_date"],matchMode:"date_window",
   dateWindowDays:7,…})   ← 参数即现在的硬编码
4. write_inputs / write_to_sheet：假设参数区（12 字段模板，默认值见附录 A）
5. write_formula：口径表（公式模板见附录 B——收入/COGS/佣金/FBA/仓储/广告/退款/净利，
   每行引用参数格与源表 SUMIFS）
6. create_pivot({rows:[sku,date],values:[item_price,spend]})
7. append_pack_audit({…counts, assumptionSnapshot, matchRate, note模板})
8. 输出：三段式人话结论（模板见附录 C——口径/近似项/风险SKU）
```

关键点：**公式字符串、参数默认值、口径表布局在 SKILL.md 里是数据**（Markdown 附录），
不是代码——改净利口径 = 改文档 + 重装 Pack，**不发版加载项**。

---

## 4. 落地阶段

### P0：补通用审计算子（唯一核心改动，非行业）

- `append_pack_audit` 注册为核心算子：`addin/skills/core/append-pack-audit/manifest.json` + skill-handlers.ts executor case + 入 HANDLED_TOOLS
- 参数对齐现有 `PackAuditEntry`（packId/packVersion/runType/counts/sourceHash/note/**+assumptionSnapshot +matchRate**，向后兼容）
- 通用性论证：审计是跨 Pack 机制（`_pack_audit` 行 schema 本就通用），进核心不违反「行业不进核心」——正如 reconcile_tables 通用算子一样

### P1：SKILL.md 重写为编排手册（**与 value-implementation 合并实施**）

把 value brief 的能力 A/B/C 直接做在 SKILL.md 里，**一次到位**（避免 TS 上做完再迁移的二次返工）：
- 能力 A（算清楚+改得动）→ 附录 A 参数区模板（12 字段）+ 附录 B 口径表公式模板
- 能力 B（能复核）→ append_pack_audit 调用模板（假设快照 + 匹配率 + <90% 警示 note）+ conditional_format 调用模板
- 能力 C（说清楚）→ 附录 C 三段式结论模板（LLM 只填 summary 数字，表体不进上下文）
- 同步修 G6：费率默认值单一真相（SKILL.md 附录 A 与 profit_formula.md §四对齐）

### P2：拆除 TS 预编排

1. skill-handlers.ts：flows 映射删 `finance` 分支（reconcile/calculate 等通用 flow 保留）
2. 删 `finance-run.ts` + `isFinanceRequest` + App.tsx 拦截点（保留 `excel/index.ts` 导出面清理）
3. 前端测试迁移：finance-run 相关单测 → SKILL.md 模板校验测试（frontmatter 合法、步骤引用的工具都在 operator-catalog、附录公式模板语法正确）
4. **保留一个验收对照脚本**（可选 dev-tools）：同输入跑「SKILL 编排」vs 录屏基线，结果表 diff 一致才关任务

### P3：验收（重走 Gate 1b 口径）

- 同 fixture：装 Pack → `/跨境业财` → LLM 按 SKILL.md 编排跑通全流程
- value brief §5 总清单逐项过（改 B4 退款率 → 净利联动、审计含快照、三段式结论）
- **新增验收项（Pack 化特有）**：
  - [ ] 同输入跑 2 次，工具调用序列一致（审计行可回放 diff）
  - [ ] **卸载 Pack 后** `/跨境业财` 不再触发该场景（行业逻辑确实出核心了）
  - [ ] 改附录 B 一个公式模板 → 重装 → 口径表变化，**加载项零重编译**

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| LLM 编排不稳定（当初 TS 预编排的存在理由） | ① 步骤模板强约束（工具名+参数完整给出，LLM 只填动态值）② 审计行记录实际调用序列，可回放 diff ③ 验收含「跑 2 次序列一致」项；不一致 → 收紧模板措辞而非回退 TS |
| 7 步多轮工具往返的 token 成本 | 每步返回小 JSON（现有算子已如此），表体不进上下文；实测超预算再评估方案 3（run_flow 数据驱动）作为加速层，**骨架不变** |
| 旧验收基线（2026-08-16 录屏）失效 | 属预期——P3 重录；期间 TS 版可保留一版作 fallback（`run_flow(finance_legacy)`，标注 deprecated，两版结果对照） |
| append_pack_audit 参数被 LLM 乱填 | 参数 schema 校验（manifest JSON Schema 已有机制）+ 审计行本身就是留痕，错了可见 |

---

## 6. 边界确认

- **核心改动仅 P0 一个通用算子**（append_pack_audit），其余核心零改动；`reconcile-core.ts` 等不动
- 行业逻辑（口径、步骤、模板）全部进 Pack：SKILL.md + knowledge
- 写格铁律不破：LLM 编排的每一步仍走注册算子 → Office JS → Excel，`user.*` 照旧不写格
- 依赖：P1 合并实施 value-implementation（口径表/把关/结论模板直接做在 SKILL.md 附录里）

---

> 执行顺序建议：P0（半天级）→ P1（与 value brief 合并，主体工作量）→ P2（拆除+测试迁移）→ P3（重验收+录屏）。
> 开工前照仓库规矩走 `scripts/git-flow.sh check`；执行器二选一皆可（有完整本 brief + value brief 双输入，适合 Codex CLI 自动跑）。
