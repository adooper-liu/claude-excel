---
status: review          # design | coding | review | fix | blocked | done
branch: feat/gate-1b-h3-sensitivity
---

# 任务：Gate 1b H3 敏感性分析立项

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/gate-1b-h3-sensitivity.md` · `feat/gate-1b-h3-sensitivity`

```bash
git checkout master && git pull && git checkout -b feat/gate-1b-h3-sensitivity
```

> 复制本文件为 `docs/tasks/gate-1b-h3-sensitivity.md`，作为 Claude Code × Cursor 的**唯一交接载体**。
> 禁止在聊天里互贴长方案/状态；另一方 `git pull` 后读此文件。
>
> **状态** 以文件顶部 frontmatter 的 `status` / `branch` 为准。改状态就改 frontmatter，别在正文另写一份。

- **主责（当前阶段）**：Claude Code（design） → Cursor（coding） → Claude Code（review） → Cursor（fix）

## 目标

依 `docs/tasks/gate-1b-self-critique.md` §3/§4：Gate 1b 原"业财闭环"商业定位被自承错误（正面打 ERP 拳头功能没赢面），商业主战场应切到 H3（敏感性/假设分析）—— "退货率 8% 涨到 12%、汇率 7.2→7.0、佣金 15%→17%，净利怎么变？哪些 SKU 到临界点就亏？" 是 ERP 给不了 / Excel 主场 / AI 增量最明显的入口。本任务在 `docs/gate-1b-mvp-closed-loop.md` §6 之后新增 §7 H3 立项，并配套改 `samples/packs/cross-border-ecommerce-finance/skills/finance-sensitivity/SKILL.md` 把场景定义落到可执行步骤 + 改 `knowledge/profit_formula.md` 加档位默认值。

> **路径修正（2026-09-01 审查）**：`gate-1b-mvp-closed-loop.md` 位于**仓库根 `docs/`**（不在 `docs/tasks/` 下）。

## 边界 / 不做

- **不碰** ERP connector（Phase 2 v1.1）
- **不写** H1/H2 新增（保持 Gate 1b MVP 4 段不动）
- **不做** 蒙特卡洛 / 多参数联合敏感（Phase 1 单参数；多参数联合 Phase 2）
- **不做** 多币种多主体联动（Phase 2）
- **不改** 核心算子实现（沿用现有）
- **不动** `reconcile_tables` / `calculate_table` / `create_pivot` —— 用 H1 已落地的 `业财利润公式` sheet 作为输入
- **只编排 9 个已注册工具**（不引入新算子）：`get_sheet_names` / `inspect_table` / `read_range` / `write_inputs` / `write_to_sheet` / `format_range` / `sort_filter` / `append_pack_audit` / `complete`
  > **修正（2026-09-01 审查）**：v1 工具清单漏了 `write_inputs`——SKILL 步骤 3「临时改 `假设参数!B{x}` 后**强制还原原值**」必须用 `write_inputs` 回写；漏列则 SKILL 无法还原（风险 1 缓解自身提到 write_inputs）。`write_inputs` 已在 P0 白名单（`tools-for-request-finance-allowlist`）内。
  > **实现核对（2026-09-03）**：registry 没有 `inspect_range`，小范围读取统一用 `read_range`；H3 独立矩阵必须由 `write_to_sheet` 创建，临界行排序使用 `sort_filter`。`append_pack_audit` 也没有顶层 `scenarios[]`，场景摘要写入现有 `note`，原 B2–B10 快照写入 `assumptionSnapshot`。

## 验收

- [x] 后端 `pytest backend/tests` 全绿（2026-09-03：353 passed, 2 skipped）
- [x] 前端 `npm run test:unit` + `npm run typecheck` 全绿（2026-09-03：322 passing；typecheck 通过）
- [ ] **任务特有（自动化契约完成，真机重装待办）**：
  - [x] `docs/gate-1b-mvp-closed-loop.md` 增 §7 H3（含 7.1–7.8 子节），§0 状态从"进行中"改为"MVP 4 段 done，H3 立项中"，§9 进度 log 加 2026-09-01 design 行
  - [x] `samples/packs/cross-border-ecommerce-finance/skills/finance-sensitivity/SKILL.md` 重写为可执行 6 步强模板（探路→读现状→算多档→标临界→审计→结论）
  - [x] `samples/packs/cross-border-ecommerce-finance/knowledge/profit_formula.md` 增"H3 档位默认值"小节（-10%/-5%/0/+5%/+10%）
  - [x] `samples/packs/cross-border-ecommerce-finance/pack.json` 升至 `0.1.3`，`skills` 数组确认含 `finance-sensitivity`
  - [ ] 重装 pack 后任务窗格 `/` 菜单能搜到 `/业财敏感性`（沿用现有 `slash:` 字段，不新增触发词）

## 方案（Claude Code 填，design 阶段）

### 1. 改动文件清单

| 文件 | 改动 |
|---|---|
| `docs/gate-1b-mvp-closed-loop.md` | §0 改状态；§6 后新增 §7.1–§7.8；§9 加进度行 |
| `samples/packs/cross-border-ecommerce-finance/skills/finance-sensitivity/SKILL.md` | 重写为 6 步强模板（与 `finance-reconciliation/SKILL.md` 风格一致） |
| `samples/packs/cross-border-ecommerce-finance/knowledge/profit_formula.md` | 增 §X "H3 档位默认值"小节 |
| `docs/tasks/README.md` | （不动，仅消费） |

### 2. `gate-1b-mvp-closed-loop.md` §7 草案（设计参考）

```markdown
## 7. H3 敏感性分析：商业验证候选（新增 2026-09-01）

> 状态：立项中；执行人/优先级待用户拍板。

### 7.1 为什么是 H3
依 `gate-1b-self-critique.md` §3/§4：H1（净利）正面打 ERP 没赢面；H2（结算拆解）只是技术验证 feed；
**H3（敏感性/假设分析）才是商业主战场** —— ERP 不做（积加/领星假设写死改不动）/ Excel 主场 /
AI 增量最明显（自然语言"退货率 8% 涨到 12% 我会怎样" → 自动改 B4 → 活公式重算 → 自然语言解释）。

### 7.2 H3 场景定义
| 维度 | 定义 |
|---|---|
| 入口 | 已有"业财利润公式" + "假设参数" sheet |
| 输入 | 单一参数（佣金率/退款率/FBA/汇率/广告占比 之一）× 一组 ±N% 档位 |
| 输出 | ① `H3_敏感性_<参数>` 新 sheet ② 临界点列（净利≤0 或 净利率<目标 标红） ③ 三段式人话结论 |
| 不做 | 蒙特卡洛 / 多参数联合敏感 / 多币种多主体联动 |

### 7.3 最小闭环（MVP for H3）
| 段 | 工具 | 范围 |
|---|---|---|
| 1 探路 | `get_sheet_names` + `inspect_table` | 拿"业财利润公式" + "假设参数" |
| 2 读现状 | `read_range` | 当前净利 + 当前假设值 |
| 3 算多档 | 临时改 `假设参数!B{x}` 5 档（-10%/-5%/0/+5%/+10%）→ `read_range` 读新净利 | 1 参数 × 5 档 |
| 4 标临界 | 找净利≤0 档 + 净利率<目标（B9）档 → `format_range` 红字 | |
| 5 审计 | `append_pack_audit({runType:"finance-sensitivity", baseSnapshot, scenarios[]})` | |
| 6 结论 | `complete({result: 三段式})` | |

### 7.4 验收三件套
- [ ] 终点 1：`H3_敏感性_<参数>` sheet 可见
- [ ] 终点 2：`_pack_audit` 有 `runType=finance-sensitivity` 记录
- [ ] 临界点行用 `format_range` 标红

### 7.5 与 Gate 1b MVP 4 段的关系
- 段 1-2（数据接入 + 对账）：沿用 H1
- 段 3（单 SKU 净利）：前置依赖；H3 跑前必须先有"业财利润公式"
- 段 4（审计）：扩展 runType；`finance-reconciliation` / `finance-sensitivity` 共存

### 7.6 SKILL 骨架
详见 `samples/packs/cross-border-ecommerce-finance/skills/finance-sensitivity/SKILL.md` 重写版。

### 7.7 Gate 视角再校准
- Gate 1b MVP = §3 三件套（H1 净利）→ ✅ done (2026-08-16 录屏)
- Gate 1b H3 = §7.4 三件套（H3 敏感性）→ 立项中
- Gate 1b 商业验证 = H3 跑通 1 个真实用户 → 满足 `docs/product-vision.md` §5 Phase 1 通过标准

### 7.8 进度 log（待补）
| 日期 | 阶段 | 负责 | 说明 |
|---|---|---|---|
| 2026-09-01 | design | Claude | §7 立项 + SKILL 重写设计 |
```

### 3. `finance-sensitivity/SKILL.md` 重写骨架

```markdown
---
name: finance-sensitivity
description: 跨境业财敏感性 — 改单一假设看净利变化。前提：已有"业财利润公式" + "假设参数" sheet。用户说"如果退款率涨到 12% / 汇率跌到 7 / 佣金涨 2 个点"等假设变动时使用。
slash: 业财敏感性
---

# 跨境业财敏感性（编排手册）

> **slash 修正（2026-09-01 审查）**：沿用**现有** `finance-sensitivity/SKILL.md` 的 `slash: 业财敏感性`，**不改成 `财务敏感性`**——改触发词会让已装包用户/录屏里的斜杠失效。验收 L49 对应改按 `业财敏感性` 搜。

> 强模板：每步工具名 + 完整参数骨架。
> 禁止：发明工具名、把表体读进对话、手改利润公式格、跳步、改 `假设参数!B{x}` 外的其它格。
> 档位默认值（与 profit_formula.md H3 小节一致）：-10% / -5% / 0 / +5% / +10%。

## 常量
| 键 | 值 |
|---|---|
| 利润表 | `业财利润公式` |
| 假设表 | `假设参数` |
| 输出 | `H3_敏感性_<参数中文名>` |
| 目标净利率 | 读 `假设参数!B9` |
| 审计 | `_pack_audit`（仅 `append_pack_audit`） |

## 编排
### 0 探路
`get_sheet_names` + `inspect_table({sheetName:"业财利润公式"})` 确认存在
+ `inspect_table({sheetName:"假设参数"})` 拿当前 B2-B10 值

### 1 选参数（用户口述）
- 关键词→单元格映射：
  - 佣金率/佣金 → `假设参数!B3`
  - 退款率/退货率 → `假设参数!B4`
  - FBA → `假设参数!B5`
  - 汇率/USD → `假设参数!B2`
  - 广告占比/TACOS → `假设参数!B10`
- 若用户没说，列出这 5 个让其选

### 2 临时改 5 档（不改原值，写到 `H3_敏感性_<参数>` 的参数快照列）
- 档位 = [原值 × 0.9, 原值 × 0.95, 原值 × 1.0, 原值 × 1.05, 原值 × 1.1]
- 写新 sheet：
  - 列：SKU | 档位1 净利 | 档位2 净利 | ... | 档位5 净利 | 临界点
  - 每行 = 利润公式 sheet 的一个 SKU

### 3 算 5 档净利
- 每档：`write_inputs` 临时改 `假设参数!B{x}` → `read_range` 读"业财利润公式"净利列 → **`write_inputs` 立即还原原值** → 下一档（还原是硬动作，防原值被破坏；工具清单已含 `write_inputs`，与风险 1 缓解一致）
- 写入新 sheet

### 4 标临界
- 净利≤0 或 净利率<目标（B9）→ `format_range` 红字（`color=#FF0000`）
- 文案："临界档：从 +5% 涨到 +10% 时 SKU-X 转亏"

### 5 审计
`append_pack_audit({packId, packVersion, runType:"finance-sensitivity", note, assumptionSnapshot, scenarios: [{param, base, target, skus_negative_at}]})`
> **修正（2026-09-01 审查）**：H3 无对账步骤，**不伪造** `matched`/`leftOnly`/`rightOnly`/`matchRate`（v1 骨架写 `matched:totalSkus, matchRate:1.0` 违反「不编基准数字」；与 §7.3 段 5 的 `scenarios[]` 一致）。审计以场景档位为内容。

### 6 结论（三段式）
- ① 当前
- ② 哪一档临界
- ③ 哪一 SKU 最先撑不住
`complete({result})`

## 边界
- 🔴 不做蒙特卡洛 / 不做多参数联合
- 🟡 单参数敏感；多参数 Phase 2
- 🟡 "假设可改"指本 skill 内临时改 + 还原，不动原 `假设参数!B{x}` 的值
```

### 4. `profit_formula.md` 新增段落

```markdown
## H3 档位默认值（与 finance-sensitivity SKILL §常量 对齐）
| 档位 | 比例 |
|---|---|
| 档位 1 | -10% |
| 档位 2 | -5% |
| 档位 3 | 0（原值） |
| 档位 4 | +5% |
| 档位 5 | +10% |

可改：用户口述 ±N% 时覆盖默认值；5 档上限。
来源：依 `gate-1b-self-critique.md` §3 立 H3 为主战场。
```

### 5. 风险与回退

- **风险 1**：临时改 `假设参数!B{x}` 后没还原 → 用户原值被破坏
  - **缓解**：步骤 2 末 `read_range` 后强制 `write_inputs` 还原；测试断言"步骤末原值不变"
- **风险 2**：H3 走 LLM prompt 编排与 H1 一样有"行为规则天花板"
  - **缓解**：把 P0 任务（`tools-for-request-finance-allowlist`）作为前置依赖；H3 skillId 若走类似路径需同步加 allowlist
- **风险 3**：商业验证要求"1 个真实用户独立跑通"——H3 录屏比 H1 录屏更复杂（5 档 + 临界标注）
  - **缓解**：H3 录屏拆"单档演示"和"5 档完整"两段；先发"单档演示"拿种子用户

## Review notes（Claude Code 填，review 阶段，只读不改代码）

**结论：实现与 brief 逐项一致，无阻塞缺陷，可合入。** 本任务为纯编排/文档定义（SKILL.md + profit_formula + pack.json + mvp §7），未改核心算子；自动化门禁全绿，1 项真机待办未勾（重装 pack 后斜杠可见）。以下 2 条非阻塞。

1. **[中·建议→已解决 2026-09-03] `finance-sensitivity` skillId 未同步白名单** — `addin/src/services/tools-for-request.ts` 只有 `finance-reconciliation` 分支（P0 已合入），`/业财敏感性`（skillId=finance-sensitivity）会落到默认 `return tools` 全量——`find_replace`/`web_fetch` 等无关工具对 H3 仍可见。与 P0 修的"工具面不受控"同类。**已解决**：单独立项 `docs/tasks/finance-sensitivity-allowlist.md`，已加 `finance-sensitivity` 分支（H3 SKILL.md 9 工具边界 + user.* 放行），2 个新 test case，324 passing 实测绿。

2. **[低] 真机待办未勾** — 验收最后一项"重装 pack 后 `/业财敏感性` 可见"为 [ ]，属用户真机侧（installed pack 需重装到 `~/.claude-excel-web/`）。SKILL.md `slash: 业财敏感性` 与 brief §7.6 一致，重装后应可触发；此项不阻塞文档/编排合入，待用户真机验证后勾选。

3. **[已确认正确]** （a）`finance-sensitivity/SKILL.md` 六步强模板：探路 → 读现状锁定单参数 → 逐档 `write_inputs→read_range→write_inputs` 强制还原 → 写矩阵+`format_range`+`sort_filter` 标临界 → `append_pack_audit`（`note` 写场景 JSON、`assumptionSnapshot` 写 before 快照，**不伪造** matched/leftOnly/rightOnly/matchRate）→ 三段式 `complete`。（b）`profit_formula.md` §六 H3 档位默认值（-10/-5/0/+5/+10，含还原约束）为单一真相。（c）`pack.json` 0.1.2→0.1.3，skills 含 finance-sensitivity。（d）`docs/gate-1b-mvp-closed-loop.md` §0 改"MVP 4 段 done，H3 立项中"，§7.1–7.8 落地，§9 进度行已补。（e）测试：H3 断言五档/还原/审计防伪造/版本 0.1.3，实测 322 passing 全绿。

4. **[已确认正确] 口径一致** — 关键数值（汇率B2=7.2/佣金B3=0.15/FBA燃油B6=0.035 等）与 `profit_formula.md` §四、`finance-reconciliation/SKILL.md` 附录 A 单一真相对齐；H3 档位一律"以读取到的原值为基准计算"，不凭空编差值（符合「不编基准数字」纪律）。

## 进度 log（谁改谁 append，一行一条）

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-09-01 | design | Claude Code | (待 commit) | §7 立项 + SKILL 重写设计；商业主战场切 H3 |
| 2026-09-01 | review | Claude Code | (待 commit) | 审查修订：路径改 `docs/` 根（`gate-1b-mvp-closed-loop.md` 不在 docs/tasks）；工具清单补 `write_inputs`（还原原值必需）；slash 沿用 `业财敏感性`（不新增触发词）；SKILL 骨架 §5 审计改 `scenarios[]`，不再伪造 matched/matchRate |
| 2026-09-03 | coding | Codex CLI | (本次提交) | 认领 H3；核对真实 registry/schema：`inspect_range` 未注册，`append_pack_audit` 不接收 `scenarios[]`，实现将用 `read_range`，场景摘要写入现有 `note`。 |
| 2026-09-03 | verify | Codex CLI | (本次提交) | H3/P&L 定向 17 passing；前端 unit 322 passing；typecheck 通过；后端 353 passed, 2 skipped。Pack 升至 0.1.3；真机重装与 §7.4 三件套留给 review/验收。 |
| 2026-09-03 | review | Claude Code | (本次提交) | 只读评审：六步强模板/五档/逐档写-读-写还原/审计防伪造（不传 matched 等）逐项核对，与 SKILL.md、profit_formula §六、pack.json 0.1.3、mvp §7.1–7.8 一致；322 passing 实测绿。**执行器主动纠正了两处 design 遗漏**（`inspect_range` 未注册→用 `read_range`；`append_pack_audit` 无 `scenarios[]`→场景写 `note`），方向正确。2 条非阻塞 note：① finance-sensitivity 未同步 P0 白名单（/业财敏感性 走全量工具面，建议单独立项补，同 Pack 一致）；② 真机重装/§7.4 待用户验证（[ ] 未勾，不阻塞文档合入）。可进入验收。 |
