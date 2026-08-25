# Post Gate 1b：能力边界放宽 backlog（v2 — 评审修正版）

> **消费者**：Gate 1b 合 master 后的实现者（Cursor / Claude Code）。  
> **前提**：Gate 1b 已 `done`（2026-08-16）。本 backlog **不动三条根骨**：① 数值 / 表体变更走 Office JS 算子；② 对账 / 整形只写新表；③ 本机 `:8765` + BYOK + 审计。  
> **v2 变更**：回应独立评审 — 拆分 fuzzy、补执行决策树、Pack 确认协议、LLM 端点 fail-closed、验收基线、Gate 1c。  
> **叙事**：§产品叙事（对外 why + 用户故事）；**契约**：§三条根骨 起（对内 how）。

---

## 产品叙事

> 本节供对外话术、Pack 介绍、录屏脚本使用。**实现参数、验收、Gate 以 §B1–B3 工程契约为准**，二者冲突时以契约为准。

### 定位一句话

**比 Copilot 更聪明不是卖点；比「把表贴去 ChatGPT + 肉眼扫公式 + 手动改键再 VLOOKUP」更安全、更可审计，才是。**

三条放宽边界都在替用户**已经在做、但做得不安全或不可追溯**的事，用阀门架构给可控替代——不拆写格单通道、不拆源表保护、不拆本机审计。

### 三条边界 × 用户替代（A 档 · 话术）

| # | 用户现在怎么做（不安全/低效） | 我们给什么 | 差异化 |
|---|---|---|---|
| **① normalize** | 先在 Excel 里 `SUBSTITUTE`/`TRIM` 改客户名或 SKU，再 VLOOKUP 回来对账 | 规则级 `matchMode: normalize`，匹配不上的进「未匹配」列，**不静默合并** | 确定性规则，可复现；不是 embedding 黑箱 |
| **② formula diff** | 业财表 C 列第 51 行起有人改过 VLOOKUP 区域，人工逐行 impossible | 同列公式模板 diff，标红异常行号 | 不做 AI 公式栏；做 **公式审计**（对准「23% 含错」类防错） |
| **③ text extract** | 付款备注列复制粘贴到 ChatGPT 拆发票号/比例 | Pack 内 `user.text_*`：建议列 + 置信度 + 待复核，BYOK 本机代理 | **数据不出域**的 ChatGPT 替代 |

**共性（对外可原句引用）：** 每一条都让「用 Claude Excel」比「不用」**更安全、更可审计**——而不是更聪明。

### 用户故事补全（B 档 · 场景，非验收数字）

**① 键标准化 — 两类真实键**

| 场景 | 键长什么样 | 工程上谁解决 |
|---|---|---|
| **Gate 1b 主路径（SKU）** | `ABC-01 ` / `abc-01` / 尾空格；广告 `ad_date` 比订单早 3 天 | 核心 `trim_lower` + `date_window`（§B1）；dirty fixture SKU-016/17/18 可录屏 |
| **Phase 2+ 扩展（公司名/ERP）** | 系统 A：`ABC Trading Ltd.` · B：`ABC Trading Limited` · C：`ABC Trading LTD` | 可选 **`normalizeRules`**（见下），默认关；不进 Gate 1c 主路径 |

可选规则表示例（Pack 或 B1 扩展，**参数化、可审计**）：

```yaml
normalizeRules:
  - stripPunctuation
  - collapseWhitespace
  - caseFold
  - expandCommonSuffixes:
      Ltd: Limited
      Co: Company
      Inc: Incorporated
```

> ⚠️ 对外勿用无源单点如「精确匹配漏 30–40%」；可演示时用 fixture / 客户试点区间，并标注来源。

**② 公式一致性 — 输出长什么样（录屏友好）**

用户看到的不是裸 JSON，而是类似：

```yaml
column: C
template_variants:
  - template: "=VLOOKUP($A{row},Sheet2!$A:$B,2,FALSE)"  # rows 2–50
  - template: "=VLOOKUP($A{row},Sheet2!$A:$C,3,FALSE)"  # rows 51–200  ← 异常
flagged_rows: [51, 52, 53, ...]
```

落盘：`_audit_formulas` 新 sheet 或对话摘要（工程实现见 §B2 `scan_formula_consistency`）。

**③ 文本列 — 跨境业财举例**

| 源列 | 典型一行 | 建议拆出 |
|---|---|---|
| `payment_notes` | `INV-2024-0815 ABC Aug payment partial 60%` | `invoice_id`, `client_hint`, `month`, `amount_pct` |

产品约束（话术层，工程细节见 §B3）：

- 只写**新表/新列**，标「AI 建议」；**不回写源列**
- 置信度 &lt; 阈值 → 行级「待复核」，用户确认后才 reshape 进正式表
- 模型只走本机 BYOK 代理，不把备注贴公网

### 刻意不做（对外解释 scope）

| 候选 | 排除理由 |
|---|---|
| 统计异常（Z-score / 隔离森林） | 要模型算「数字是否异常」，和「模型不碰数值」根骨冲突；业财异常多是**规则差额**，不是分布 |
| NLQ 自然语言问数 | Copilot 级交互投入；与「Pack 作业流不是聊天」定位冲突；ROI 低 |
| 整表 fuzzy JOIN | 低置信自动合并 = 对账事故；normalize 已覆盖多数格式脏；语义 fuzzy 仅 Pack 建议 |
| AI 自动生成公式栏 | 与 Copilot 正面竞争；我们站在 **公式审计 + 活公式算子**，不站在公式栏 |

---

## 评审结论（摘要）

| 维度 | v1 | v2 处置 |
|---|---|---|
| B1 fuzzy 架构模糊 | 🔴 | **从核心 reconcile 移除**；核心只保留 `exact \| normalize \| date_window`；字符串/语义模糊 → Pack 预处理器 |
| B1 多模式组合顺序 | 🟡 | 补 **§B1.3 决策树** |
| B3 确认机制 | 🟡 | 补 **§Pack 交互协议**（显式 apply，非泛化「好的」） |
| B2 公式边界 | 🟡 | 补 **不支持类型清单** + fixture |
| B3 分批标签漂移 | 🟡 | **枚举约束** + 首批冻结 schema |
| B3 LLM 端点 | 🔴 | manifest **`llmProxy: "local_only"`** + fail-closed |
| `__review` vs `_pack_audit` | 🟡 | 双下划线审计列 + `_pack_audit` 只记 run 级汇总 |
| 验收无基线 | 🟡 | 附 dirty fixture 分布 + Gate 1c |

---

## 三条根骨（不可退让）

1. **算子算**：匹配、公式 diff、列映射落地均在可单测 TS / Office JS；LLM 只产 JSON 建议，不写格。  
2. **源表保护**：`reconcile_tables` / `reshape_table` / `extract_selection` 仍只写新 sheet。  
3. **本机审计**：run 级 → `_pack_audit`（`pack-audit.ts`）；行级 → 新表 **`__*` 双下划线列**（见 §0），后续 `project` 默认跳过 `__` 前缀列。

---

## §0 · 审计列命名约定（全 backlog 通用）

| 层级 | 位置 | 记什么 | 示例 |
|---|---|---|---|
| **Run 级** | `_pack_audit` sheet | 谁在何时跑了什么 Pack；匹配计数汇总 | `matched=12, review_pending=3` |
| **行级** | 对账 / derive 结果新表 | 逐行匹配质量、待复核标记 | `__match_mode`, `__match_score`, `__review` |

**规则：**

- 业务算子（`reshape op=project` 等）**默认不映射 `__` 前缀列**；要带走到下游须显式 `columns[].from`。  
- `_pack_audit.note` 可引用 `review_pending=N`，**不展开逐行**（与行级列分工）。

---

## B1 · 对账：`normalize` + `dateWindowDays`（核心，不含 fuzzy）

### B1.1 范围（刻意收窄）

| 能力 | 所在层 | 说明 |
|---|---|---|
| `exact` | 核心 `reconcile-core.ts` | 现状：`trim` 后字符串相等 |
| `normalize` | 核心 | `trim` / `trim_lower` / `trim_collapse_ws`（键部分） |
| `dateWindowDays` | 核心 | 同非日期键匹配后，对**仍未配对**行做 ±N 天窗口二次配对 |
| **字符串 fuzzy**（Levenshtein 等） | **不在 v2 核心** | 大表 O(n²) 风险；若要做 → Pack `user.reconcile_key_suggest`（见 B1.4） |
| **语义 fuzzy**（embedding / LLM） | **Pack only** | 与 B3 同构；**禁止**进 `reconcile-core.ts` |

> **评审修正**：v1 把 `fuzzy` 枚举进 reconcile manifest 但未定义算法 → v2 **删除核心 fuzzy**；避免「本地 fuzzy vs 模型 fuzzy」架构级模糊。

### B1.2 参数（`reconcile_tables` manifest 扩展）

```typescript
matchMode?: "exact" | "normalize" | "date_window"  // 默认 exact
keyNormalize?: "trim" | "trim_lower" | "trim_collapse_ws"  // normalize / date_window 时生效；默认 trim
dateWindowDays?: number   // 仅 matchMode=date_window；keys 须含恰好一个日期列对（leftDateKey + rightDateKey）
leftDateKey?: string
rightDateKey?: string
auditColumns?: boolean    // 默认 true（非 exact 时写 __* 列）
```

### B1.3 执行决策树（实现者必须按此顺序）

```
输入：leftRows, rightRows, keys[], matchMode, keyNormalize, dateWindowDays?

1. 构建键
   for each row:
     keyPart[i] = normalizeKeyPart(row[keys[i]], keyNormalize)  // 空键 → 不参与匹配

2. 阶段 A — 精确键匹配（所有 mode 都做）
   compositeKey = keyParts.join("\x1f")
   用 compositeKey 做 hash 配对（同键多行 → conflict，与现逻辑一致）
   已配对的行标记 usedL / usedR

3. 阶段 B — 仅当 matchMode ∈ { normalize, date_window }
   对 keys 做 keyNormalize 后重复阶段 A（若 normalize 已在步骤 1 完成则跳过重复）
   // 注：normalize 模式 = 步骤 1 用 trim_lower 等，仍是一次 hash 配对

4. 阶段 C — 仅当 matchMode = date_window 且 dateWindowDays = N
   在「阶段 A/B 后仍未配对」的行上：
   a. 按「除日期外的键部分」分组（已 normalize）
   b. 组内：left 行 order_date 与 right 行 ad_date 差 ∈ [-N, +N] 天
   c. 每组取**最小日期差**配对（差相同 → conflict，不静默择优）
   d. __match_mode = "date_window"；__match_score = 1 - (|Δdays| / (N+1))

5. 剩余 → left_only / right_only

6. 写输出新表
   若 auditColumns：追加 __match_mode, __match_score, __review
   __review = "auto" 当 __match_mode=exact 且 score=1
   __review = "需复核" 当 date_window 配对或 conflict
```

**`_match_mode` 取值**：`exact` | `date_window` | `left_only` | `right_only` | `conflict`（无 `fuzzy`）。

### B1.4 Pack 扩展（可选，Phase 1.5+）

`user.reconcile_key_suggest`（**不写格**）：

- 输入：未配对的 `left_only` / `right_only` 键样本（≤100 对）  
- 输出：`[{ leftKey, rightKey, score, method: "levenshtein"|"llm" }]`  
- 用户 **显式 apply** 后，才可把映射表喂给 `reshape op=project` 写「键映射表」新 sheet，再二次 reconcile  

字符串 Levenshtein 若进核心，须单独立项并证明 **blocking + 候选上限**（如每 left 行最多比 20 个 right 候选）；**本 backlog 不包含**。

### B1.5 交付物

| 项 | 路径 |
|---|---|
| 纯函数 + 测试 | `addin/src/excel/reconcile-core.ts`、`addin/tests/reconcile-core.test.ts` |
| manifest | `addin/skills/core/reconcile/manifest.json` |
| project 跳过 `__` 列 | `addin/src/excel/recipe-project.ts`（默认 filter） |
| Pack | `finance-reconciliation/SKILL.md` 第 3 步可选 `matchMode: "date_window", dateWindowDays: 7` |
| 文档 | `addin/skills/core/reconcile/SKILL.md` |

### B1.6 验收标准与基线

**Dirty fixture 分布**（`dev-tools/gen_dirty_fixtures.py`，50 订单 / 40 广告）：

| 脏类 | 行数（约） | normalize 能否消 |
|---|---|---|
| SKU 尾空格 / 大小写 | 4+ | ✅ `trim_lower` |
| 日期格式混排 / UTC | 4+ | ✅ connector `coerce date`（对账前 project） |
| 金额 N/A / 空 / $ | 6+ | ❌ 不影响键匹配 |
| 归因偏移 ad_date 早 3 天 | **3**（SKU-016/17/18） | ❌ exact；✅ **date_window** |
| 孤行 / 缺失 SKU | 2+ | 应留 left_only / right_only |

**量化基线（Gate 1b 干净 5/4 行）**：exact → `matched=2, left_only=3, right_only=2, conflict=0`（录屏记录）。

**B1 必达（dirty 50/40，project 后 reconcile）**：

| 指标 | exact 基线（需 pytest 快照） | B1 date_window=7 目标 |
|---|---|---|
| matched | 记录首次跑 snapshot | **≥ exact + 3**（至少收回 3 行归因偏移） |
| 归因偏移行 SKU-016/17/18 | left_only 或 right_only | **matched + __review=需复核** |
| 源表 `Pack_*` | 零写入 | 零写入 |
| `_pack_audit.note` | — | 含 `review_pending=` 计数 |

### B1.7 Gate 1c（B1 用户级验收，轻量）

- **起点**：dirty fixture 已 `gen_dirty_fixtures.py`  
- **路径**：`/跨境业财` 或 pytest 等价链，**开启** `dateWindowDays: 7`  
- **终点**：录屏 ≤5min — 展示 `业财对账结果` 中 SKU-016 行 `__match_mode=date_window`、`__review=需复核`；`_pack_audit` 新一行  
- **通过**：归因 3 行不再全部是 left_only/right_only；待复核列可见  

---

## B2 · 公式列一致性：`scan_formula_consistency`

### B2.1 范围

只扫**单元格公式**（`Range.formulas`），不扫条件格式规则（CF 另立项）。

### B2.2 模板归一化规则

| 情况 | 处理 |
|---|---|
| 普通 A1 / $A$1 引用 | 行 → `R`，列 → `C`；保留 sheet 前缀 |
| `INDIRECT(...)` / `OFFSET(...)` / `INDEX(...)` 含动态行 | 标记 **`__consistency=unsupported`**，**不参与**一致率分母 |
| 数组公式 / 溢出范围 | 仅取 **anchor 格**（公式所在格）；溢出区不扫 |
| 纯常数 / 空 | 跳过 |

**不支持即跳过，禁止硬比误报**（评审要求）。

### B2.3 工具 schema

```typescript
// 新工具 scan_formula_consistency（只读）
{ sheetName?, tableName?, columns?, templateRow?: 2, maxOutliers?: 30 }
// 返回：{ column, consistencyRate, outliers:[{address, reason}], unsupported:[{address, reason}] }
```

### B2.4 Fixture（单测必含）

1. `=SUMIFS($E$2:$E$100,A:A,A2)` 列内一致  
2. 第 5 行漏 `$` → outlier  
3. `=INDIRECT("A"&ROW())` → unsupported，不计入误报  

### B2.5 验收

- [ ] 只读，零写格（`/规范` 可选 `format_range` 标橙，用户显式触发）  
- [ ] Gate 1b 簿 `业财利润公式` SUMIFS 列 consistencyRate = 1  
- [ ] 1000×10 公式列 < 15s（`CHUNK_ROWS=2000`）  

---

## B3 · 文本列结构化：Pack `user.text_column_suggest` + 显式 apply

### B3.1 两层架构

| 层 | 职责 | 写格 |
|---|---|---|
| **A. suggest** | `user.text_column_suggest` → JSON 建议 | ❌ |
| **B. apply** | 用户 **显式 apply** → `reshape_table op=derive`（或 project） | ✅ 新 sheet only |

### B3.2 Pack 交互协议（非 Agent prompt 自律）

**1. suggest 返回契约**

```jsonc
{
  "phase": "suggest_only",
  "targetFields": {
    "故障类型": { "enum": ["硬件", "软件", "网络", "其他"], "frozen": true },
    "紧急度": { "enum": ["高", "中", "低"], "frozen": true }
  },
  "rows": [{ "rowIndex": 2, "values": { "故障类型": "硬件", "紧急度": "中" }, "confidence": 0.92 }],
  "batchId": "uuid",
  "schemaVersion": 1
}
```

**2. 分批一致性**

- **首批**（batch 0）返回后，后端缓存 `targetFields.*.enum`；后续批次 prompt **必须注入同一 enum**（`frozen: true`）。  
- 模型输出 **不在 enum 内** → `"values": { "故障类型": "其他" }` + `confidence: 0` + 行级 `__review=需复核`。  
- **禁止**批次间新增标签（业务口径不由模型发明）。

**3. 确认（apply）触发条件 — 必须同时满足**

| # | 条件 |
|---|---|
| 1 | Agent / UI 已展示 **建议摘要**（字段 enum + 前 5 行样例 + 低置信度计数） |
| 2 | 用户输入 **显式 apply 指令**（见白名单） |
| 3 | `batchId` 与最近一次 suggest 一致 |

**Apply 白名单（正则）**：

- `应用文本列建议` / `apply text suggest` / `确认写入建议列`  
- **不接受**：单独「好的」「继续」「写吧」（泛化确认无效）

**4. apply 执行**

- 仅调用 `reshape_table op=derive`（新 op 或 project + 映射表），输出新 sheet  
- 低置信 / 越 enum 行 → `__review=需复核`  
- `_pack_audit` 追加：`runType=text_suggest_apply`, `note=suggest_rows=50,applied_rows=50,review_pending=3`

### B3.3 LLM 端点（根骨③ — manifest 硬约束）

扩展 extension manifest（**schema 校验，非 README**）：

```jsonc
{
  "name": "user.text_column_suggest",
  "network": false,
  "llmProxy": "local_only",   // 新增必填枚举：local_only | forbidden
  "llmEndpoint": "http://127.0.0.1:8765/api/llm/proxy"
}
```

| 规则 | 行为 |
|---|---|
| `llmProxy=local_only` | handler **仅**允许 POST `127.0.0.1:8765`（或配置中的 loopback 代理） |
| 代理不可达 | 返回 **`PROXY_UNAVAILABLE`**，fail-closed；**禁止** fallback 公网 |
| `llmProxy=forbidden` | 不得调用 LLM（纯规则 suggest） |
| runner 预检 | `user_fn_runner.py` 校验 manifest；handler 内 urllib 目标非 allowlist → 拒绝 |

> 现有 manifest `network: true` 走 `ce_http` + 公网 URL，**不适用于 LLM**；LLM 走独立 `llmProxy` 字段，避免与 `safe_http_url` 混用。

**安装提示**（UX 补充，非安全保证）：「此函数会将 ≤50 行/批文本送至 **本机** LLM 代理（BYOK），不外发默认云端。」

### B3.4 验收

- [ ] suggest 阶段工作簿无新列  
- [ ] 泛化「好的」不触发 apply（单测 / 手工）  
- [ ] 代理停服 → `PROXY_UNAVAILABLE`，无静默公网  
- [ ] 两批 suggest 标签集一致；越 enum → `__review`  
- [ ] apply 后仅新 sheet；源列只读  

---

## 实施节奏与 Gate

| 阶段 | 内容 | 完成标志 |
|---|---|---|
| **B1** | normalize + date_window + `__*` 列 + project 跳过 | **Gate 1c** 录屏 |
| **B2** | scan_formula_consistency + fixture | 单测 + Gate 1b 簿扫描绿 |
| **B3** | manifest `llmProxy` + suggest/apply 协议 + derive op | Pack 试点 + apply 白名单单测 |

**不建议 Phase 2 前并行第四条**（NLQ 一体问数、全簿 CF 扫描、核心 Levenshtein reconcile）。

### Gate 1d / 1e（算子词汇，与 B1–B3 并行轨道）

> **设计选择（不突破）**：核心 fuzzy、ERP OAuth —— 见上文「刻意不做」。  
> **真实瓶颈（可突破）**：`calculate_table` 词汇贫乏、链式对账缺压平、缺受限 IF、缺多维活公式交叉表。  
> **停线**：扩到 SKILL 编排不再靠 `write_formula` 手拼计算逻辑为止；再往后是编排确定性（LLM 跳步），加算子解决不了。

| Gate | brief | 内容 | 状态 |
|---|---|---|---|
| **1d** | [`gate-1d-operator-vocab.md`](gate-1d-operator-vocab.md) | `sumifs_multi`（或扩 sumifs）· `arithmetic` · `flatten_reconcile` · `conditional_column` | ready |
| **1e** | [`gate-1e-analysis-ops.md`](gate-1e-analysis-ops.md) | `cross_tab` · `lookup_multi` · `flag_rows` | blocked on 1d |

---

## 开工前检查表

| 问题 | B1 | B2 | B3 |
|---|---|---|---|
| 数值经 LLM 手算？ | 否 | 否 | 否 |
| 改源表？ | 否 | 否 | 否 |
| 默认 backward compatible？ | 是（exact） | 是（新工具） | 是（需装 Pack） |
| 算法 / 端点是否写死可审计？ | 是（决策树） | 是（unsupported 清单） | 是（llmProxy + enum） |

---

## 变更 log

| 日期 | 说明 |
|---|---|
| 2026-08-17 | v1 草稿（对话） |
| 2026-08-17 | v2 独立评审修正：移除核心 fuzzy、补决策树 / 协议 / 基线 / Gate 1c |
| 2026-08-24 | 增补 Gate 1d/1e 指针（算子词汇 vs 分析扩展；与 B1–B3 分轨） |
| 2026-08-17 | §产品叙事：合并 A/B 档（话术 + 场景）；工程契约未改 |
