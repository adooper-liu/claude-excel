# 文档消费链（谁读、何时读、怎么用）

> 每份文档必须有明确的消费者。本文是新建文档前的参考——先看这里，判断新内容应落进已有文档还是新建。遵守 `CLAUDE.md`「文档纪律」。

---

## A. 运行时被代码直接执行

| 文档 | 谁读 | 何时 | 怎么用 |
|---|---|---|---|
| `pack.json` | `backend/user_packs_store.install_pack()` | 安装 Pack 时 | 读 `skills[]`/`extensions[]`/`knowledge[]`，校验一致性，复制到 `~/.claude-excel-web/` |
| `extensions/*/manifest.json` | `backend/user_extension_registry.list_extensions()` | 每次 `/api/user-fn` 扫描时 | 注册 `user.*` 工具（name/params/network/secrets），计算 capabilityHash，判定 authorized |
| `extensions/*/handler.py` | `backend/user_fn_runner.run_user_fn()` | 每次调用 `user.*` 时 | 子进程执行，stdin JSON → stdout JSON |
| `connector/feeds/*.schema.json` | `handler.py` `_load_schema()` | 每次调 `user.connector_load_feed` 时 | 读 canonical 列名，决定输出 header |
| `connector/fixtures/*.csv` | `handler.py` `load_feed()` | 同上 | 读 fixture CSV → 编码探测 → 列映射 → 归一 → 返回 canonical rows |
| `addin/src/excel/pack-audit.ts` | `skill-handlers` `append_pack_audit` | Pack 技能跑完写审计时 | Office JS 直写 `_pack_audit` sheet |
| `addin/src/services/user-fn.ts` | LLM 调 `user.connector_load_feed` 时 | Pack SKILL 步骤 1（缺表时） | `fetch POST /api/user-fn/user.connector_load_feed`，解析 envelope |
| `backend/server.py` | 全部路由 | 每次 HTTP 请求 | `require_loopback`，代理 LLM / 取数 / RAG / Pack / user.* |
| `backend/user_packs_store.py` | `server.py` | 安装/卸载/列 Pack 时 | `install_pack()` / `uninstall_pack()` / `list_packs()` |
| `backend/user_extension_registry.py` | `server.py` / `user_fn_runner.py` | `/api/user-fn` 每次调用时扫描 | 扫 manifest，注册工具，计算能力哈希，判定授权 |

---

## B. 对话时进 LLM 上下文（作为 prompt 或 RAG 检索）

| 文档 | 谁读 | 何时 | 怎么用 |
|---|---|---|---|
| `skills/*/SKILL.md` | `getAllTools()` → tool description → LLM | 对话开始时 tool 列表注入；skill 触发后全文注入 | frontmatter（name/slash）→ tool 注册；body → LLM 读 recipe 步骤，决定调哪些核心算子 |
| `knowledge/*.md` | 知栏 `search_knowledge` → RAG → LLM | 用户上传到知栏后；LLM 调 `/知识` 或 `search_knowledge` 时 | 分块 → 向量索引 → 检索命中片段 → 注入 LLM 上下文 |
| `CLAUDE.md` | Claude Code / Cursor Agent 启动时（非 LLM 对话） | 新会话开始时 | 作为 system prompt 注入 Agent，设定边界/纪律/三层/写格单通道 |

---

## C. 开发者 / Agent 参考（代码不读，人读）

| 文档 | 谁读 | 用途 |
|---|---|---|
| `CLAUDE.md` | Claude Code · Cursor · 人 | 主入口：产品定位、三层边界、开发纪律、命令、斜杠清单 |
| `AGENTS.md` | Claude Code · Cursor | 多工具协同摘要（阶段分工 + 交接规则） |
| `docs/product-vision.md` | 人 | 架构 + 商业价值 + 路线图总览（随时回顾） |
| `docs/file-structure.md` | 人 | 每个目录/文件干什么（快速定位） |
| `docs/pain-points.md` | 人 | 跨境数据处理痛点 · 来源 + 解法映射（对外话术底稿 + Pack 接法，同一页查） |
| `docs/domain/dirty-data-patterns.md` | 人 · pack 作者 · Claude Code | 脏数据坑典（已证实 / 候选 + 解决层 + 证据）：写 pack knowledge、定算子参数、评审 pack 覆盖度时查表 |
| `docs/document-usage.md` | 人 | 本文——每份文档的消费者清单 |
| `docs/coordination.md` | Claude Code · Cursor | 完整协同规则（主目录/分支/阶段/交接/串行化/会话生命周期） |
| `docs/harness-guide.md` | 人 · Claude Code | Harness 六层框架摘要 + 本项目对照（参考文档；来源 liziran.com 长文） |
| `docs/migration.md` | 人 | 换机台 / 新机台部署时对照执行（README 快速启动的增量：带数据走 + 重建机台相关项） |
| `docs/tasks/*.md` | Claude Code · Cursor | 任务 brief（目标/边界/验收/方案/Review notes/进度 log） |
| `docs/user-packs.md` | 人 · Cursor | P0 Pack 设计（目录/schema/API/禁令/checklist） |
| `docs/user-extensions-security.md` | 人 · Cursor | P1 `user.*` 安全边界（威胁模型/子进程/信任门/能力声明） |
| `connector/README.md` | 人 · Cursor | connector 抽象契约（feeds schema → canonical 列 → recipe 不认数据源） |
| `connector/implementations/*/README.md` | 人 · Cursor | csv_local / erp 实现接口（Phase 1 = 约定，Phase 2 = 代码） |
| `recipe/hosts/*.yml` | `backend/recipe_hosts.py` | 进簿后 project 列映射（L2 核心数据） |

---

## 四句话总结消费链

```
安装时：pack.json → install_pack() → 复制 skill / knowledge / extensions / connector 到 ~/.claude-excel-web/

对话时：SKILL.md（prompt）→ LLM 选工具 → 核心算子（Office JS）或 user.*（子进程）
         └─ knowledge/*.md → 知栏上传 → RAG 检索 → LLM 查片段

执行时（业财）：已装 Pack 的 SKILL.md → LLM 逐步调算子（connector_load_feed / reconcile / write_inputs / calculate / pivot / append_pack_audit）

参考时：人读 docs/*.md → 定位 / 边界 / 痛点 / 来源 / 路线图 / 文件用途
```