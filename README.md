# SheetWise

AI 驱动的**独立** Excel 加载项——不绑 Claude 付费账号，填自己的 API Key 即可用。在工作簿侧边栏用自然语言读写、清洗、格式化、做图、透视、对账，结果直接写回单元格。

## 价值与优势

**不比聪明，比可靠。** 市面上的 AI Excel 插件都在拼「生成的聪明程度」，本项目拼的是「乱不乱写」——可靠性是硬约束，不是口头承诺。

- **算得清** — 计算不靠模型猜：活公式（INDEX/MATCH、SUMIFS）写回单元格，合计随源表自动变；洗表、对账、透视全部在 Excel 内用 Office JS 完成，表体不进模型上下文，省 Token 且结果与 Excel 公式一致。
- **算明白** — 每一步都给依据：调研给摘要与引用、知识库检索标来源文档、假设与口径只列选项并说明来源，不黑箱、不替拍板。
- **可审计** — 写入只经核心算子单一通道，源表只读、假设只改假设格不碰公式——改了什么、改没改源表、依据在哪，全程留痕、可回滚。
- **不编数字** — 行业数字必须带来源或标「用户提供 / 待验证」，没有真表不生成假费率。
- **不绑 Claude 付费账号，数据不出本机** — 自带本地后端代理（只绑 127.0.0.1），接 DeepSeek / 通义千问 / GLM 多模型，填自己的 API Key 即用；密码与站点账号只在任务窗格本机填写，不发给模型。
- **中文自然语言直接说** — 选中区域，说「按金额降序」「大于 100 标红写入 C 列」「创建销售额柱状图」即得结果。
- **可扩展场景包** — `/拆解` 拆业务流、`/skill-creator` 装本机技能；行业口径与阈值只进用户侧 Pack，核心保持通用干净。

## 功能一览

| 口令 | 能力 |
| --- | --- |
| `/取数` | 网页 / ERP 结构化表行进簿 |
| `/调研` | 核实开放信息、多源对比、给口径选项 |
| `/知识` | 检索本机知识库（RAG） |
| `/整形` | 清洗表格、选区去空格 / 统一大小写 |
| `/对账` | 源表只读，四类差异对比 |
| `/计算` | INDEX/MATCH、SUMIFS 活公式 |
| `/透视` | 数据透视、切片、趋势 |
| `/假设` | 改税率 / 运费 / 广告费等假设，下游重算 |
| `/拆解` | 把业务流拆成可执行步骤（🟢 全自动 / 🟡 要人判断 / 🔴 必须人做） |
| `/skill-creator` | 把 🟢 步骤写成可安装技能 |

## 快速启动

> 🟢 **第一次用、不熟命令行？** 先看 **[小白版安装使用指南](docs/getting-started-guide.md)**——从环境准备到 API Key 配置的保姆级教程（含三种安装方式对比、常见问题速查卡）。本节是给熟悉命令行的人的精简版。

### 1. 首次安装（仅一次）
双击 `install.bat`。
- 检查 Python / Node.js
- 生成并信任 Office 开发者证书 (HTTPS)
- 构建 addin 前端
- 创建 `backend\.venv` 并安装 Python 依赖
- 将插件注册到 Excel

开发前端时再在 `addin/` 下执行 `npm start`。完整链路（后端 + Excel）请用 `launch.bat`。

### 2. 日常启动
双击 `launch.bat`：
- 检查证书
- 启动后端（:8765）
- 打开 Excel 并加载插件

在侧边栏 ⚙ 中配置 API Key（或写 `C:\Users\<用户名>\.claude-excel-web\config.json`）。

## 使用

1. 在 Excel 中选中数据区域
2. 一键按钮：分析 / 报告（走 AI）；清洗 / 排序 / 加粗 / 数据条（本地，不耗 Token）
3. 聊天框输入自然语言，例如：
   - 按金额降序排列
   - 给 B 列加数据条
   - 大于 100 的标红，写入 C 列
   - 创建销售额柱状图

## API Key

```json
{
  "apiKey": "sk-你的key",
  "baseUrl": "https://api.deepseek.com/anthropic",
  "model": "deepseek-v4-pro[1m]",
  "smallFastModel": "deepseek-v4-flash"
}
```

- DeepSeek: `https://api.deepseek.com/anthropic`
- 阿里百炼: `https://dashscope.aliyuncs.com/apps/anthropic`
- 智谱 GLM: `https://open.bigmodel.cn/api/anthropic`

环境变量 `DEEPSEEK_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 优先于文件。

## 目录结构

```
claude-excel/
├── backend/           ← LLM 代理 + 配置 + 托管加载项 dist
├── addin/             ← Excel 加载项
│   ├── manifest.xml
│   └── skills/core/   ← 工具声明（必须有 executor）
├── skills/README.md   ← Skill 契约
└── launch.bat
```

## 常见问题

**Q: Excel 加载项安全警告？**  
A: 管理员运行一次 `npx office-addin-dev-certs install`。

**Q: Key 验证失败？**  
A: Key 格式因供应商而异（DeepSeek 以 `sk-` 开头；智谱 GLM / 通义 Qwen 等无前缀），确认填的是对应供应商的 API Key 且能访问。

**Q: 如何加新工具？**  
A: 见 `skills/README.md`。manifest 没有 executor 时后端会拒绝启动。
