# 产品架构与商业价值（总览）

> 本文是项目的「为什么 + 是什么 + 往哪走」，随时回顾用。
> **纪律细节以 [CLAUDE.md](../CLAUDE.md) 为准**；任务级精确状态看 `docs/tasks/*.md` 与 `git log`，本文只给层面判断。

---

## 1. 定位（一句话）

**Claude Excel = Excel 里的 AI 入户配电箱**：模型是水电气（BYOK，用户自选供应商）；ERP 是上游水厂（伙伴，不竞争）；我们是**管道（取数进表）+ 阀门（源表保护/信任门）+ 计量（审计）+ 分户套餐（Pack）**。卖「可重复的业财作业包」，不卖通用聊天、不卖「比 Copilot 聪明」。

---

## 2. 商业价值

| 轴 | 用户得到什么 | 我们卖什么 |
|---|---|---|
| **省人力** | 日更对账/洗表/透视从 2h → 20min | 编排好的 Pack 作业流 |
| **省事故** | 源表不被 AI 乱改，对账/整形只写新表 | 写格单通道 + 保护源表（技术壁垒） |
| **省合规焦虑** | 本机 :8765、密钥不进模型、`user.*` 信任门 | 「本机可控 Agent」叙事 |
| **省认知成本** | 不用学 9 个斜杠，装 Pack 就能 `/跨境业财` | Pack = 可安装 SOP |

**核心客户（ICP）**：5–50 人跨境团队，Excel 就是业财系统、不想上全链路 ERP、不敢让 AI 碰源表、愿意 BYOK。

**明确不服务**：只问「VLOOKUP 怎么写」的个人、要全云 SaaS 的企业 IT、期望「AI 替我做所有商业判断」的用户。

**两条关键商业判断（已定）**：
1. **ERP（店小秘/马帮/积加/领星）= 上游水厂，不是竞品**。平台 raw 数据经 ERP 洗净，Pack 内 connector 拉同构表进 Excel，做 ERP 不做的「本机假设/对账/透视最后一公里」。
2. **二段对账**：第一段「订单×广告→利润假设」（我们做）；第二段「收单×汇率×费率→净结算」（Antom/连连做）。**先做第一段，第二段留接口不留内容**。

---

## 3. 架构（三层 + 写格单通道）

| 层 | 是什么 | 位置 | 写 Excel |
|---|---|---|---|
| **A. 核心算力** | 通用 Office JS 算子（~28 个） | `addin/skills/core` + `skill-handlers.ts` | ✅ **唯一写格通道** |
| **B. 核心数据** | 站点 DOM / project 列映射 | `backend/site_recipes/`、`recipe/hosts/` | ❌ 配置 |
| **C. 用户扩展** | Pack：Skill + 知识 + recipe + `user.*` + connector | `samples/packs/` → `~/.claude-excel-web/` | ❌ 全部不写格 |

**写格路径（强制）**：`用户/Skill 编排 → 核心算子 → Office JS → Excel`。禁止 Skill、`user.*`、Python openpyxl 直接写格。

**后端 :8765**（只绑 127.0.0.1）：LLM 代理 · 取数 · 知识 RAG · 用户技能 · Pack 安装 · **`user.*` 执行**（子进程 + clean_env + timeout + 能力声明哈希 + 信任门）。

**`user.*` 安全模型（P1 轴心）**：独立命名空间，**不进** `HANDLED_TOOLS` / `ADDIN_HANDLERS`；子进程隔离（主 LLM key 永不进函数）；装 Pack 时一次确认「含本地代码」，**能力声明变化 → 重新授权**。

**四条铁律（路线图不得违背）**：
1. 行业口径/阈值/SOP **只进 Pack**，核心只做通用算子 + 数据引擎。
2. ERP 品牌/字段映射 **只许在 `connector/`**，核心底座不认识任何 ERP。
3. Skill **只编排核心算子**，不写 Python、不调 `scripts/*`（Antom 式脚本不属于本仓库）。
4. 取数 ≠ 调研 ≠ 知识库，三者分列。

---

## 4. 二段对账（关键商业判断）

```
平台订单 × 平台广告 → 毛利/利润假设（第一段，我们做，Phase 1）
        ↓
毛利 − 平台佣金 − 收单费率 − 退款费 − 汇损 → 净结算（第二段，Antom/连连，Phase 2）
        ↓
银行到账金额（最终真相）
```

- **第一段（业财对账）**：订单×广告→利润假设。Gate 1b 用本地 CSV 跑通，recipe 编排核心算子。
- **第二段（收单对账）**：结算明细→净结算→到账。Phase 2 经 connector 接（`erp_antom`/`erp_lingxing`），**recipe 与核心算子不动**。
- **接缝已经留好**：connector 抽象 + feeds schema（canonical 列名）。recipe 只认 canonical 列，不认数据来源。

---

## 5. 路线图（Gate 驱动，不是日历驱动）

| 阶段 | 内容 | 状态 |
|---|---|---|
| **Phase 0** | 底座 + P0 Pack + P1 `user.*` + P1 UX + 协同规范 | ✅ 已落地 |
| **Phase 1** | **Gate 1b**：一个 Pack 一个场景一条路——`/跨境业财` 30min 从脏数据跑通「订单×广告→利润假设」，源表不改，录屏可复现 | 🚧 进行中 |
| **Phase 2** | 积加/领星二选一 connector（recipe 不动）+ Pack 订阅 + 客户案例 | 🗺️ 规划 |
| **Phase 3** | 第三方 Pack 上架、卸载、`minCoreVersion`、企业版 | 🗺️ 规划 |

**Gate 通过标准**：Phase 1 = 1 个真实用户独立跑通闭环（或 1 个付费/试点意向）→ 才进 Phase 2。

---

## 6. 当前状态（层面判断，精确状态看 git）

- **✅ 已落地**（合 master，后端 97 passed / 前端 212 passing / typecheck 绿）：核心底座 + 三方锁步 · 取数/调研/知识分列 · P0 Pack 安装 · P1 `user.*` + 信任门 · P1 UX（卸载/NOT_AUTHORIZED/未授权标记）· 多工具协同规范。
- **🚧 进行中**（`feat/gate-1b-finance`）：Gate 1b 业财闭环——`finance-reconciliation` SKILL（编排核心算子）+ connector（`csv_local`/`erp_*`）+ `_pack_audit` + fixtures。

---

## 7. 一句话收束

**技术底座（管道 + 阀门 + 计量 + 套餐机制）已经造好，商业验证缺的不是再一层架构，而是「一个能 30 分钟跑通、有人愿意付钱」的垂直 Pack。** 下一步：实现 Gate 1b 三样（`_pack_audit` + 知识文件 + fixtures），拿真实脏数据，录屏。
