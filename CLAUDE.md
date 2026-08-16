# CLAUDE.md

本文件给在本仓库里改代码的人看。产品目标：**独立的 AI Excel 插件**，不绑 Claude 付费账号。

多工具协同（Claude Code × Cursor）见 **`docs/coordination.md`**（摘要 **`AGENTS.md`**）。

## 定位：三层 + 底层/用户侧边界（已定）

先做稳 **Excel 底座**。跨境物流、跨境电商、HR、财务等是底座上的**用户场景包**，不进核心代码。

### 三层 vs 写格权

| 层 | 是什么 | 位置 | 写 Excel |
|---|---|---|---|
| **A. 核心算力** | 通用 Office JS 算子 | `addin/skills/core` + `skill-handlers.ts` | ✅ **唯一写格通道** |
| **B. 核心数据** | 站点 DOM / project 列映射 | `backend/site_recipes/`、`recipe/hosts/` | ❌ 配置 |
| **C. 用户扩展** | Pack：Skill + 知识 + recipe 声明 +（P1）`user.*` | `samples/packs/` → `~/.claude-excel-web/` | ❌ **全部不写格** |

**写格路径（强制）：** 用户 / Skill 编排 → 核心算子 → Office JS → Excel。禁止 Skill、`user.*`、Python openpyxl 直接写格；禁止把用户函数注册进 `HANDLED_TOOLS` / `addin/skills/core`。

详细 Pack 规则见 **`docs/user-packs.md`**；`user.*` 安全见 **`docs/user-extensions-security.md`**（P1 已落地）。

**ERP 定位（已定）：** 店小秘 / 马帮 / 积加 / 领星等是**上游数据伙伴（水厂）**，不是竞品。平台 raw 数据经 ERP 鉴权与清洗后，Pack 内 **connector（L3）** 拉取同构表进 Excel；核心底座**不出现**任何 ERP 品牌与字段映射。Claude Excel 做入户管道 + 分户计量 + 阀门，做 ERP 不做的本机假设/对账/透视最后一公里。

工作流先拆再自动化（`/拆解` → `/skill-creator`）。拆解规则：命名 → 动作流 → 判断点 → 边界 → 验证；🟢 全自动 / 🟡 要人判断 / 🔴 必须人做。口径只列选项，不替用户拍板。不编基准数字。

### 第一层：Excel 底座（基本功能，已定）

| 能力 | 入口 | 建模 | 分析 | 决策支持 |
|---|---|---|---|---|
| 读结构 / 公式 / 错 | `inspect_*` `scan_formula_errors` | 分清输入格与公式格 | 错在哪 | 不编数字 |
| 取数 | `/取数`、取数栏 | 外部**结构化表**进簿 | — | 密码不进模型 |
| 调研 | `/调研`、默认对话 | 摘要、引用、口径选项 | 多源对比 | 不替拍板；默认不落表 |
| 知识库 | `/知识`、知栏 | 检索已上传文档片段 | 与开放网对照 | 无命中不编造；默认不落表 |
| 洗表 | `/整形`、提取选中列 | 长表才能建模；选区去空格/统一大小写 | 列可用 | — |
| 对账 | `/对账` | 源表只读 | 四类差异 | 冲突给人判 |
| 活公式 | `/计算` `write_formula` | INDEX/MATCH、SUMIFS | 合计随源表变 | — |
| 改假设 | `/假设` `write_inputs` | 改税率/运费/广告费，下游重算 | 情景 | 不覆盖公式 |
| 透视 / 图 / 格式 | `/透视` `create_chart` `/规范` | — | 切片、趋势 | — |
| 筛选 / 填充 / 替换 / 验证 | `sort_filter` `fill_range` `find_replace` `data_validation` | 下拉约束假设格 | 可见行、填公式 | — |
| 流程变技能 | `/拆解` → `/skill-creator` | — | — | 选项 + 验证锚点 |

默认对话就是通用 Agent。斜杠是加速器。对账/整形只写新表；其余默认可就地改。

加载项用微软 **Office JavaScript API**。后端 `:8765` 只做 LLM 代理、配置、取数、用户技能。模型：DeepSeek / 通义千问 / GLM。

### 第二层：拆解（连接底座和行业）

`/拆解` 把「清关对账」「广告 ROI」还原成可执行步骤，并标哪些能用现有工具做。拆完的 🟢 步骤再 `/skill-creator` 装进 `~/.claude-excel-web/skills/`。

### 第三层：用户场景包 Pack（已定，不进核心）

**行业口径、方法论、阈值只进用户侧**。**禁止**写回 `addin/src/services/` 核心 TS（含 `industry-workflows.ts` 一类）。**禁止**以 onboarding 为由把行业流程塞回核心——此边界已定，不再讨论。

**Pack = 装箱，不是新机制**（P0 已落地）：把 Skill、knowledge、recipe 依赖声明按 **category** 分组；`install_pack` 复用 `install_skill`，不新增执行器。

```
samples/taxonomy.json              # category 单一真相（跨境电商 / 跨境物流 / HR / 财务 …）
samples/packs/{pack-id}/
  pack.json                        # skills[] / knowledge[] / deps.recipes[]
  skills/*/SKILL.md                # 只编排核心算子
  knowledge/*.md                   # 方法论附录 → 知栏 / search_knowledge
~/.claude-excel-web/
  skills/                          # 已装 Skill
  knowledge/                       # RAG
  installed_packs.json             # 已装 pack 记录
```

| 进核心（A+B） | 不进核心（C） |
|---|---|
| `site_recipes/` — DOM 提取默认 | 选品/SERP/利润/VOC/清关**怎么判** |
| `recipe/hosts/` — 进簿后 project 列映射 | 公司阈值、GMV 口径、SOP 正文 |
| 通用算子 + `/取数` | **P1** `user.*` 本机函数（独立命名空间，见安全文档） |

**onboarding**（不编译进 builtin）：

1. **`samples/packs/`** — 官方场景包；`GET/POST /api/user-skills/packs` · `install-pack`
2. **`samples/` 附录** — 如 `industry-deconstruct-appendix.md`（可迁入 pack/knowledge）
3. **知识库** — `~/.claude-excel-web/knowledge/` + `/知识`

`/拆解` 指向上述三条线，不把附录写进核心 prompt。🟢 步骤走 `/skill-creator` 或 Pack 内 SKILL。

可选参考见 `samples/packs/cross-border-ecommerce/`（`/亚马逊选品`）。

| 场景 | 建模 | 分析 | 决策（列选项，不替拍板） |
|---|---|---|---|
| 跨境物流清关 | 完税价格、税率、杂费在假设格；关税活公式 | 申报 vs 放行对账；按 HS/口岸透视 | 归类口径、查验、退运 vs 缴税 |
| 跨境电商运营 | 到岸成本、广告费、退款率作假设；毛利重算 | 订单 vs 仓 vs 广告对账；按 SKU 透视 | 停投/加投、测试单是否计入 GMV |

行业数字必须带来源或标「用户提供 / 待验证」。没有真表就不要生成假费率。

## 取数 vs 调研（强制分列）

二者都要保留，**禁止合成**成一个产品需求、一套 UI 或一条口令。

| | 取数 | 调研 |
|---|---|---|
| 目标 | 把网页/ERP 里的**表行**写进工作簿 | 核实开放信息、对比口径、给摘要与引用 |
| 产出 | Excel 表 + recipe + 可选 `reshape_table(project)` | 对话里的结论；用户明确要求才写小摘要表 |
| 入口 | 取数栏、扩展点选、`/取数`、`web_fetch`→`write_to_sheet` | `/调研`、默认对话 + `web_search`（DeepSeek） |
| 不做 | 竞品分析长文、政策解读、替用户拍板 | 登录站批量抓表、替代取数栏跟手操作 |
| 重叠时 | 用户要「把这张公开表进簿」→ 取数 | 用户要「这个政策/竞品什么意思」→ 调研 |

取数栏、Playwright picker、recipe 只服务取数。站点 DOM 默认在 **`backend/site_recipes/{host}.json`**；进簿后列映射在 **`recipe/hosts/{host}.yml`**（引擎加载，不进 picker 选择器）。不要把 web-access 类浏览器栈并进核心；调研靠模型检索 + 可选 `web_fetch` 只读正文，不并进取数栏。

## 知识库（本机向量 RAG）

与取数、调研**分列**。用户上传 .md/.txt/.csv 到 `~/.claude-excel-web/knowledge/`，本机分块 + 向量索引（默认本机哈希向量；`config.json` 设 `embeddingModel` 可走 API embeddings）。对话用 `search_knowledge` 或 `/知识` 检索片段并引用 docName；无命中不要编内部规定。不做表行进簿，默认不落表。

## 能力汲取

外部产品（含 Anthropic 公开技能、Claude for Excel）里有用的能力，做成我们自己的 Office JS + 中文步骤。禁止原文/脚本进仓库。不要搬 openpyxl / LibreOffice / `recalc.py`。

## 两种改表模式

| 模式 | 何时 | 规矩 |
|---|---|---|
| **保护源表** | `/对账` `/整形`、提取选中列 | 只写新表；关掉手写格子，走 `reconcile_tables` / `reshape_table` / `extract_selection` |
| **就地改** | 默认、格式、图表、假设、公式、透视、取数、筛选、填充、替换、验证 | 改当前簿。假设只用 `write_inputs` |

`/计算` 把活公式写到新表，避免合计写死。`/拆解` 与 `/skill-creator` 创建时只读，不改表。

## 架构

```
Excel 任务窗格 (React + Office JS)
  → 核心工具   addin/skills/core/*/manifest.json
  → 核心执行器 addin/src/services/skill-handlers.ts
  → 登记       HANDLED_TOOLS 与 ADDIN_HANDLERS（缺一则启动失败）
本机后端 :8765（只绑 127.0.0.1）
  → LLM 代理、取数、知识 RAG、用户 Skill、Pack 安装
  → 用户目录   ~/.claude-excel-web/{skills,knowledge,fetch-recipes,installed_packs.json}
  → P1 规划    user.* 独立注册表（不进 HANDLED_TOOLS，见 docs/user-extensions-security.md）
```

开发期 `npm start` 用 `manifest.xml` 指向 `https://localhost:3000`。`npm run build` 后清单改指向 `https://localhost:8765`，由后端托管 `addin/dist`。不要绑 `0.0.0.0`。

## Office JS 优先，模型最省 Token（强制）

Excel 格子、公式、格式、图表、透视、分块洗表全部在加载项用 **Office JS** 做完。模型上下文里不要进表体。

模型只补 Office JS 做不了的：含糊需求理解、工具与参数选择、口径选项、结果解释。`inspect` 只送表头和少量样本。禁止「读进对话 → 模型改数字 → `write_to_sheet`」。

任务窗格 **＋** 开新会话，**☰** 看历史会话（本机 localStorage）。**↩** 是撤销结果表，不是会话历史。

## Skill 纪律（强制）

**manifest 里没有 executor 的工具，启动即失败。** 禁止为了让服务起来而删校验，或把未实现工具留在 manifest 里。

## 算子要通用，口令不要堆（强制）

洗表/改表做成**参数化算子**，不要为某一句中文加专用函数。

- **算子**（该做厚）：`reshape_table(op=…)`、`extract_selection({column, caseMode, unique})`、`reconcile_tables`、`calculate_table`。列名、选区、是否去重都是参数，不写死「店铺」。提取与去重按 2000 行分块读写，不把百万行网格载入 JS，也不进模型。
- **口令**（该做薄）：斜杠与 `isXxxRequest` 只是加速器。默认对话靠模型选工具 + 多轮历史。「继续」只复述上一句；「继续去重」这类补参数走已有算子（`extract_selection unique` / `reshape_table dedupe`），禁止再写 `mergeXxxFollowup`。
- **短路只留给硬约束**：万行禁止经模型 `write_to_sheet`；对账/整形禁止手写假结果表。不是每种说法都要本地正则。
- **后续动词走历史**：用户补了去重/大小写时，设已有工具参数，不要新写一段只认这一句的代码。
- **行业不上核心**：清关、电商口径走 `/拆解` + 用户技能。

## 斜杠

斜杠是加速器，不是用法。任务窗格空状态用自然语言例句，不要把九个 `/` 铺开。用户主动打 `/` 再按关键字过滤；`/skills` 才列出全部。

| 斜杠 | 层 | 作用 |
|---|---|---|
| `/取数` `/调研` `/知识` `/整形` `/对账` `/计算` `/透视` `/假设` `/规范` | 底座 | 见上表；**取数≠调研≠知识库** |
| `/拆解` | 连接 | 五步拆流程，标 🟢🟡🔴，不改表 |
| `/skill-creator` | 连接 | 把 🟢 步骤写成可安装技能 |

## 常用命令

### 后端
- **安装依赖**: `pip install -r backend/requirements.txt` 后执行 `playwright install chromium`
- **启动服务**: `cd backend && python server.py` (端口 8765，有证书则 HTTPS)

### Excel 加载项
- **安装依赖**: `cd addin && npm install`
- **启动调试**: `cd addin && npm start`
- **构建**: `cd addin && npm run build`
- **验证清单**: `cd addin && npm run validate`
- **单元测试**: `cd addin && npm run test:unit`

### 综合启动
- **一键启动**: `launch.bat`
- **环境安装**: 管理员运行 `install.bat`

## 开发规范

- **新工具**: `addin/skills/core/<name>/manifest.json` → `executeHandler` case → `HANDLED_TOOLS` 与 `ADDIN_HANDLERS` → `skill-loader.ts` import → 重启后端
- **算子 vs 口令**: 先扩工具参数，再考虑短路。禁止为新说法堆 `isXxxRequest` / `mergeXxxFollowup`。见上文「算子要通用，口令不要堆」
- **行业包 / Pack**: 不要为清关/电商新增无执行器的**核心**工具名。用户 SKILL 只编排 `skill-create-guide.ts` 算子。**禁止**恢复 `industry-workflows.ts` 或把 SOP 写进 `builtin-skills.ts`。**禁止**把 `user.*` 注册进 `addin/skills/core`。新增官方示例 → `samples/packs/` + `docs/user-packs.md` checklist。
- **Pack API**: `user_packs_store.install_pack`；测试 `test_user_packs_store.py`。
- **user.*（P1）**: 动代码前必读 `docs/user-extensions-security.md` 并完成 review。
- **配置**: `C:\Users\<User>\.claude-excel-web\config.json` 或设置面板
- 公司站点账号只在任务窗格本机填写，不要发给 LLM
