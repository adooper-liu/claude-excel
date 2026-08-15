# CLAUDE.md

本文件给在本仓库里改代码的人看。产品目标：**独立的 AI Excel 插件**，不绑 Claude 付费账号。

## 定位：三层

先做稳 **Excel 底座**。跨境物流清关、跨境电商运营等是底座上的行业包：建模 + 分析 + 决策支持。行业口径不写进核心工具。

工作流先拆再自动化（`/拆解` → `/skill-creator`）。拆解规则：命名 → 动作流 → 判断点 → 边界 → 验证；🟢 全自动 / 🟡 要人判断 / 🔴 必须人做。口径只列选项，不替用户拍板。不编基准数字。

### 第一层：Excel 底座（基本功能，已定）

| 能力 | 入口 | 建模 | 分析 | 决策支持 |
|---|---|---|---|---|
| 读结构 / 公式 / 错 | `inspect_*` `scan_formula_errors` | 分清输入格与公式格 | 错在哪 | 不编数字 |
| 取数 | `/取数`、取数栏 | 外部表进簿 | — | 密码不进模型 |
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

### 第三层：行业包（后做，不进核心）

| 场景 | 建模 | 分析 | 决策（列选项，不替拍板） |
|---|---|---|---|
| 跨境物流清关 | 完税价格、税率、杂费在假设格；关税活公式 | 申报 vs 放行对账；按 HS/口岸透视 | 归类口径、查验、退运 vs 缴税 |
| 跨境电商运营 | 到岸成本、广告费、退款率作假设；毛利重算 | 订单 vs 仓 vs 广告对账；按 SKU 透视 | 停投/加投、测试单是否计入 GMV |

行业数字必须带来源或标「用户提供 / 待验证」。没有真表就不要生成假费率。

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
  → 工具声明  addin/skills/core/*/manifest.json
  → 执行器    addin/src/services/skill-handlers.ts
  → 登记      HANDLED_TOOLS 与 ADDIN_HANDLERS（缺一则启动失败）
本机后端 :8765（只绑 127.0.0.1）
  → LLM 代理、web-fetch（凭据只走本机）、用户技能 ~/.claude-excel-web/skills/
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
| `/取数` `/整形` `/对账` `/计算` `/透视` `/假设` `/规范` | 底座 | 见上表 |
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
- **行业包**: 不要为清关/电商新增无执行器的工具名；用 `/拆解` + 现有工具 + 用户技能。用户 SKILL.md 必须编排 `skill-create-guide.ts` 里的算子，禁止发明工具。
- **配置**: `C:\Users\<User>\.claude-excel-web\config.json` 或设置面板
- 公司站点账号只在任务窗格本机填写，不要发给 LLM
