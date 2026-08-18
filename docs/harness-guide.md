# Harness 六层框架 — 参考摘要与本项目对照

> 状态：参考文档（尽力准确）· 整理于 2026-08-18
> 来源：李自然《Harness 完全指南：六层框架、三个案例、一场争论》（liziran.com，2026-05-14，约 1.3 万字，附 30 余条参考文献）
> 谁读：人 + Claude Code / Codex / Cursor 在讨论 harness、协同、编排、会话生命周期时参考。本文是**摘要 + 对照**，不复制仓库已有规则正文（见 [coordination.md](coordination.md)、[AGENTS.md](../AGENTS.md)）。

## 核心公式

> **Agent = Model + Harness** —— AI 从「回答问题」转向「执行行动」后，工程重心从 prompt / context 移到「设计 AI 的运行环境」。围栏是给跑得快的马用的。

## 六层框架

| 层 | 内容 | 要点 |
|---|---|---|
| **指令层** | 系统提示词、AGENTS.md、CLAUDE.md、skills | 规则应对应真实失败（一条规则一次失败）；「给 AI 一张地图，不是一本手册」 |
| **上下文层** | 动态决定放什么进上下文窗口 | 不是塞更多，而是塞更干净；结构化进度文件做跨会话交接；子智能体的核心价值是隔离噪音 |
| **工具层** | 文件读写、命令行、Git、MCP | 工具与任务精确匹配，不是越多越好（Stripe 按任务加载工具组） |
| **边界层** | 权限、沙盒、网络隔离、密钥、审批 | 「拒绝优先」设计；爆炸半径要在事故前设计好 |
| **反馈层** | 测试、类型检查、linter、CI、日志、review | 错误消息应写成「给智能体看的修复提示」；代码质量基础设施是 AI 的传感器 |
| **治理层** | 成本监控、审计、人工升级、组织模板、回归评估 | harness 从个人 prompt 文件变成组织资产 |

贯穿六层的两个原则：**前馈给方向（引导）+ 反馈看偏差（检查）**；**能用代码强制的，就不要写成「请记得」**（溯源至维纳的控制论）。

## 三个案例

- **Anthropic 长任务**：换班交接设计——初始化智能体拆任务 + 进度文件；长任务的核心是留下清楚的交接物。
- **Anthropic Research**：主智能体拆解问题、子智能体并行搜索、只交回干净摘要——子智能体的价值不只是分工，更是**上下文隔离**。
- **Stripe Minions**：智能体写代码、确定性脚本检查、失败就修、再失败交人——**自由度只留给真正需要推理的地方**，其余交给确定性系统。

## 「harness 会消失吗」争论

2026-05 Sequoia AI Ascent 大会，Claude Code 负责人 Boris Cherny 抛出「Coding is solved」「Harness will disappear」及印刷术类比。拆解：Cherny 说的「消失」只指**补丁层**——为弥补模型缺陷而存在的壳（提示词注入防御、静态命令校验、人工审批），会被更强的模型消化；**反馈层、治理层、上下文层这些基础设施不会消失**。

- **「补丁会消失。基础设施不会。」**
- Addy Osmani 用数据反驳：高 AI 渗透团队 PR 合并量 +98%、但 review 时间 +91%，造词「comprehension debt（理解债）」——**摩擦没有消失，只是搬家了**，从写代码搬到 review / verify。
- METR 实验：资深开发者自以为用 AI 快 20%，实测慢 19%。
- 历史类比：1980 年代通用汽车（盲目自动化、「灯灭工厂」）vs 丰田（「安灯停线」、人在异常下做判断）——验证与治理负载会随自动化上升。

## 最小 harness 四件套

1. **AGENTS.md / CLAUDE.md**（规则，50–80 行为宜，一条规则对应一次真实失败）
2. **init.sh**（开工前环境检查）
3. **feature_list.json**（机器可读任务状态：`not_started` / `in_progress` / `blocked` / `passing`；同一时间只允许一个 `in_progress`；无验证证据不得标 `passing`）
4. **progress.md**（跨会话交接记录）

会话生命周期：**开始**（读规则、跑 init）→ **选择**（只选一个任务）→ **执行**（跑 typecheck / lint / test / build）→ **收尾**（更新状态与交接文档）。分级：个人级 → 团队级（3–20 人）→ 组织级，大多数人停在 Level 1 或 2。

## 控制感的盲区

安全风险：间接提示注入、工具投毒、第三方 MCP 不被审计；「误报的代价远小于漏报」。更深一层（Andrew Maynard 的批判）：harness 隐喻默认控制者与被控制者边界清晰、默认纯工具关系，但 AI 会反驳你的判断；代码从工程师的「作品」变成「采纳物」，组织可能成为黑箱——「三天后我自己都解释不清那段代码怎么工作」。

## 本项目对照（2026-08-18）

六层 × claude-excel 协同配置：

| 层 | 现状 | 强度 |
|---|---|---|
| 指令层 | 根 `CLAUDE.md` + 项目 `CLAUDE.md`（三层/写格/文档纪律）+ `AGENTS.md` + `docs/coordination.md` + 任务 brief 模板 + superpowers skills | 🟢 强 |
| 上下文层 | `docs/tasks/<任务>.md` brief 作跨工具交接物（目标/边界/验收/方案/review/进度 log）；plan 文件 + git 桥 | 🟡 中 |
| 工具层 | `scripts/git-flow.sh` / `codex-execute-latest-plan.sh`；工具与任务匹配度好 | 🟢 中强 |
| 边界层 | 三层架构 + 写格单通道、分支 + 串行化、codex `--sandbox workspace-write`、后端仅绑 127.0.0.1、公司账号不进 LLM | 🟢 强 |
| 反馈层 | 测试门禁（pytest + test:unit + typecheck）、review notes、code-review skill | 🟢 中强 |
| 治理层 | 文档纪律、单一真相、版本同步（PICKER_VER / manifest） | 🟡 中 |

**四件套适配落地**（2026-08-18）：

| 四件套 | 本项目实现 |
|---|---|
| AGENTS.md / CLAUDE.md | 已有；本次补「会话生命周期」小节（AGENTS.md） |
| init.sh | `git-flow.sh env`（环境自检，只读；并入 `check`） |
| feature_list.json | brief 顶部 frontmatter `status` / `branch` + `git-flow.sh status`（校验「只有一个进行中」「done 需验收全勾」） |
| progress.md | brief 的「进度 log」表 + `finish` 收尾提示更新状态 |

**未做（记录，不实施）**：反馈层「错误消息写成给 AI 的修复提示」、治理层「plan→code 执行成功率回归评估」——按文档纪律暂不建，需要时再评估。

## 来源

- 原文：<https://liziran.com/zh/column/2026-05-14-harness-complete-guide/>
- 本仓库协同规则（完整版）：[coordination.md](coordination.md)；摘要：[AGENTS.md](../AGENTS.md)
- 任务 brief 模板：[docs/tasks/_template.md](tasks/_template.md)
