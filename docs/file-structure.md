# 项目文件结构与用途

> 随时查阅，快速定位「某个东西在哪」。**精确内容以实际文件为准**，本文只给结构概览。

## 顶层

| 路径 | 用途 |
|---|---|
| `CLAUDE.md` | **主入口**：产品定位、三层边界、开发纪律 |
| `AGENTS.md` | 多工具协同（Claude Code × Cursor）摘要 |
| `README.md` / `package.json` | 项目说明 / 依赖 |
| `launch.bat` `install.bat` `start.bat` | 一键启动 / 环境安装 |
| `manifest.xml` | Office 加载项清单 |

---

## `addin/` — Excel 加载项（前端，React + Office JS）

### `addin/src/services/` — 工具注册与编排层（大脑）

| 文件 | 用途 |
|---|---|
| `skill-registry.ts` | `HANDLED_TOOLS` 集合（**三方锁步**之一） |
| `skill-handlers.ts` | 核心算子 `executeHandler` switch（锁步之二） |
| `skill-manifests.ts` / `skill-loader.ts` | 核心 manifest 汇总 / `getAllTools` |
| `claude.ts` | LLM 对话 loop（tool use） |
| `user-fn.ts` / `user-skills.ts` | `user.*` 执行 / Pack 安装卸载（前端） |
| `builtin-skills.ts` / `slash-skills.ts` | 内置技能 / 斜杠加速器 |
| `skill-create-guide.ts` / `operator-catalog.ts` | skill-creator / 算子目录 |
| `tools-for-request.ts` | **按场景筛工具**（如 `/对账` 隐藏写格算子） |
| `context.ts` / `token-counter.ts` / `token-meter.ts` | 选区上下文 / token 计量 |

### `addin/src/excel/` — Office JS 算子实现层（手脚，~50 文件）

每个算子「四件套」：`*-core.ts`（纯逻辑）· `*-run.ts`（执行）· `*-intent.ts`（意图守卫）· 主文件。

| 核心算子 | 相关文件 |
|---|---|
| **对账** | `reconcile.ts` / `reconcile-core.ts` / `reconcile-intent.ts` / `reconcile-run.ts` |
| **整形** | `reshape.ts` / `reshape-core.ts` / `reshape-intent.ts` / `reshape-run.ts` |
| **提取** | `extract.ts` / `extract-core.ts` / `extract-intent.ts` / `extract-run.ts` |
| **计算** | `calculate.ts` / `calculate-core.ts` / `calculate-intent.ts` / `calculate-run.ts` |
| **透视** | `pivot.ts` / `pivot-core.ts` |
| **写输入** | `write-inputs.ts` / `write-inputs-core.ts` |
| **巡检** | `inspect.ts` / `formula-inspect.ts` / `formula-inspect-core.ts` |
| **数据验证** | `validation.ts` / `validation-core.ts` |
| **排序过滤** | `filter-core.ts` |
| **填充** | `fill.ts` / `fill-core.ts` |
| **查找替换** | `find-replace.ts` / `find-replace-core.ts` |
| **格式** | `format.ts` / `format-core.ts` |
| **图表** | `chart.ts` |
| **写格/范围** | `write.ts` |
| **意图守卫** | `intent-guard.ts` |

新增（Gate 1b）：
- `finance-run.ts` — **业财预编排**：`connector → reshape(project) → reconcile_tables → write_inputs → calculate_table → create_pivot → _pack_audit`
- `pack-audit.ts` — **`_pack_audit`** 审计写入

其他：`index.ts`（总导出）· `project-infer-core.ts` · `range-chunk.ts` · `recipe-project.ts` · `sheet-history.ts` · `style-core.ts` · `table-name.ts` · `append-rows.ts` · `data-ops.ts` · `read.ts` · `sheet.ts` · `table.ts` · `sheet-name.ts`

### `addin/src/taskpane/components/` — React UI（16 个组件）

| 组件 | 用途 |
|---|---|
| `App.tsx` | **主组件**：对话流、tool 路由、Pack 安装/卸载入口 |
| `ChatPanel.tsx` | 对话列表 + Pack 卡片（安装/卸载按钮） |
| `ChatInput.tsx` | 输入框 + Skill 卸载 |
| `MessageBubble.tsx` | 消息气泡 |
| `KnowledgeBar.tsx` | 知识栏（文件上传/检索） |
| `FetchBar.tsx` | 取数栏 |
| `Header.tsx` | 顶部操作区 |
| `HistoryPanel.tsx` | 操作历史（↩ 撤销结果表） |
| `SessionList.tsx` | 会话历史（☰） |
| `SettingsPanel.tsx` | 设置面板 |
| `HeroList.tsx` | 空状态示例 |
| `PromptMenu.tsx` | 斜杠菜单 |
| `SelectionBadge.tsx` | 选区指示 |
| `TokenBadge.tsx` | Token 用量 |
| `ResultActions.tsx` | 结果操作按钮 |
| `TextInsertion.tsx` | 文本插入 |

### `addin/src/commands/` — 功能区命令

| 文件 | 用途 |
|---|---|
| `commands.ts` `commands.html` | Excel 功能区按钮 |

### `addin/skills/core/*/manifest.json` — 核心算子清单（锁步之三）

---

## `backend/` — 本机后端（Python FastAPI，`:8765` 只绑 127.0.0.1）

| 文件 | 用途 |
|---|---|
| `server.py` | 主入口 + 全部路由（`require_loopback`） |
| `ai_proxy.py` | LLM 代理（DeepSeek/通义/GLM） |
| `config_store.py` | 配置（`~/.claude-excel-web/config.json`） |
| `skill_registry.py` | 后端三方锁步校验（`ADDIN_HANDLERS`） |
| `user_skills_store.py` | 用户 Skill 安装/删除 |
| `user_packs_store.py` | Pack 安装/**卸载** |
| `user_extension_registry.py` | `user.*` 扫描 + capabilityHash |
| `user_fn_runner.py` | `user.*` 子进程执行（clean_env/timeout/并发） |
| `extension_secrets.py` | 扩展密钥（`extension-secrets.json`） |
| `web_tools.py` | 通用网页取数（`safe_http_url`） |
| `web_browser.py` | Playwright 浏览器（子进程级隔离先例） |
| `web_ingest.py` | 网页摄取（WebSocket） |
| `fetch_recipe.py` | 取数 recipe 管理 |
| `recipe_hosts.py` | 进簿后列映射引擎 |
| `knowledge_store.py` | 知识库 RAG（向量检索） |
| `templates_store.py` | 格式模板 |
| `user_fn_runtime/ce_http.py` | `user.*` 联网助手（走 `safe_http_url`） |
| `tests/` | pytest（97 个用例） |

---

## `samples/` — 官方场景包（L3，不进核心）

- `taxonomy.json` — **category 单一真相**（跨境电商/物流/HR/财务）
- `packs/` — **一 pack 一 Gate/场景**，分别安装（见 [user-packs.md](user-packs.md) §10）
  - `cross-border-ecommerce-research/` — Gate 1a 选品（无 extensions）
    - `pack.json` · `skills/amazon-research/SKILL.md` · `knowledge/`
  - `cross-border-ecommerce-finance/` — Gate 1b 业财闭环
    - `pack.json` · `skills/finance-reconciliation/SKILL.md` · `knowledge/`
    - `extensions/{profit-assumptions,connector-csv-local}/` — `user.*` 扩展
    - `connector/` — feeds schema + fixtures（**ERP 接缝**）
- `skills/` — 遗留单技能安装（`install-sample`）

---

## 其它目录

| 路径 | 用途 |
|---|---|
| `docs/` | [product-vision](product-vision.md)（总览）· [user-packs](user-packs.md) · [user-extensions-security](user-extensions-security.md) · [coordination](coordination.md) · [tasks/](tasks/)（任务 brief） |
| `extension/` | **浏览器扩展**（取数栏 / DOM picker）：`manifest.json` + `background/content/picker/popup` + `net-hook.js` |
| `recipe/hosts/*.yml` | **核心数据（L2）**：进簿后 project 列映射（amazon/ebay/walmart/1688） |
| `~/.claude-excel-web/` | **用户运行时目录**：`config.json` · `skills/` · `knowledge/` · `packs/` · `fetch-recipes/` · `extension-secrets.json` · `installed_packs.json` |

---

**一句话对应**：`addin/` = 大脑+手脚（算与写格）· `backend/` = 心脏（LLM 代理/取数/RAG/`user.*`）· `samples/` = 可卖套餐（Pack）· `recipe/` = 核心数据 · `docs/` = 单一真相 · `extension/` = 取数浏览器端。