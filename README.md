# Claude Excel

AI 驱动的 Excel 数据分析工具。支持 Web 浏览器和 Excel 原生侧边栏两种使用方式，共享同一套 AI 引擎和配置。

## 前置条件

- **Python 3.10+**（需安装 `pip`）
- **Node.js 18+**（需安装 `npm`）
- **Excel 桌面版**（仅 Excel 侧边栏模式需要）
- **DeepSeek / 通义千问 / GLM API Key**（任一即可）

## 首次部署

### 1. Python 依赖

```bash
pip install fastapi uvicorn python-multipart httpx pandas openpyxl numpy scipy
```

### 2. 前端依赖与构建

```bash
cd web
npm install
npm run build
cd ..
```

### 3. Excel 加载项依赖与构建（可选）

```bash
cd addin
npm install
npm run build
cd ..
```

## 启动

### 方式 A：Web 版（推荐，任何人可用）

```bash
cd backend
python server.py
```

浏览器自动打开 `http://localhost:8765` → 填入 API Key → 上传 Excel → 开始使用。

### 方式 B：Excel 加载项

**终端 1：**
```bash
cd backend
python server.py
```

**终端 2：**
```bash
cd addin
npm start
```

Excel 自动打开 → 设置面板 → 连接模式选 **Proxy** → 后端地址 `http://localhost:8765` → 填入 API Key → Connect。

### 方式 C：一键启动

双击 `start.bat`（启动后端 + Excel 加载项）。

## 操作流程

### Web 版

1. 打开 `http://localhost:8765`
2. 首次使用：点 ⚙ → 选供应商（DeepSeek/千问/GLM）→ 填 API Key → 保存
3. 拖拽或点击上传 Excel 文件
4. 在聊天框输入问题，如 "分析销售趋势"、"找出金额最大的 5 行"
5. AI 自动读取数据、分析、输出结果
6. 点击 "清洗并下载" 获取处理后的 Excel

### Excel 加载项

1. 在 Excel 中选中数据区域
2. 右侧面板自动显示选区信息
3. **一键按钮**（零 Token，本地执行）：
   - 📊 分析 / 📋 报告 — AI 驱动
   - 🧹 清洗 / 📈 排序 / B 加粗 / 📊 数据条 — 本地执行
4. 聊天框输入自然语言指令：
   - "按金额降序排列"
   - "给 B 列加数据条"
   - "大于 100 的标红，写入 C 列"
   - "创建销售额柱状图"
5. AI 自动调用工具执行，结果直接写入工作表

### API Key 管理

两种配置方式任选其一：

**方式 1：文件配置（推荐，无需 UI 操作）**

创建 `C:\Users\<用户名>\.claude-excel-web\config.json`：

```json
{
  "apiKey": "sk-你的key",
  "baseUrl": "https://api.deepseek.com/anthropic",
  "model": "deepseek-v4-pro[1m]",
  "smallFastModel": "deepseek-v4-flash"
}
```

多供应商参考：

```json
// DeepSeek
{"apiKey":"sk-xxx","baseUrl":"https://api.deepseek.com/anthropic","model":"deepseek-v4-pro[1m]"}

// 阿里百炼（通义千问）
{"apiKey":"sk-xxx","baseUrl":"https://dashscope.aliyuncs.com/apps/anthropic","model":"qwen3-coder-plus"}

// 智谱 GLM
{"apiKey":"xxx","baseUrl":"https://open.bigmodel.cn/api/anthropic","model":"glm-4-plus"}
```

**方式 2：UI 配置**

启动后在设置面板（⚙）中选择供应商、填入 Key、保存。自动写入上述文件。

- Web 版和 Excel 版共享同一份配置文件
- 环境变量 `DEEPSEEK_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN` 优先级高于文件

## 目录结构

```
claude-excel/
├── backend/           ← Python 后端（API + AI 代理 + Excel 引擎）
│   ├── server.py      ← FastAPI 入口
│   ├── excel_core.py  ← Excel 数据处理引擎
│   ├── ai_proxy.py    ← AI API 代理（SSE 流式）
│   └── config_store.py← 配置持久化
├── web/               ← Web 前端（Vite + React）
│   └── dist/          ← 构建产物
├── addin/             ← Excel 加载项（Office Add-in）
│   └── manifest.xml   ← Office 清单
├── skills/            ← SKILL 工具定义（共享）
└── start.bat          ← 一键启动脚本
```

## 分发到其他机器

### 开发机构建

```bash
cd addin && npm run build     # 构建加载项
cd web   && npm run build     # 构建 Web 前端
```

### 目标机安装

1. 复制整个 `claude-excel` 文件夹到目标机
2. 右键 `install.bat` → **以管理员身份运行**
3. 配置 API Key（二选一）：
   - 文件：创建 `C:\Users\<用户名>\.claude-excel-web\config.json`
   - UI：启动后在浏览器设置面板填写
4. 双击 `start.bat` 开始使用

### install.bat 做了什么

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1 | `office-addin-dev-certs install` | 生成 Office WebView 认可的证书 → 复制到 backend/ |
| 2 | `pip install` | 安装 Python 依赖 |
| 3 | 写注册表 | 注册加载项到 Office，Excel 自动识别 |

### 权限说明

- 证书信任：`office-addin-dev-certs install` 自动完成，**需管理员权限**
- 注册表写入：`HKCU` 路径，**无需管理员**
- 日常使用：`start.bat` 启动，**无需管理员**

### 目标机环境要求

- Python 3.10+（含 pip）
- Node.js 18+（仅 `install.bat` 生成证书时需要，日常使用不需要）

## 常见问题

**Q: Web 版打开后页面空白？**
A: 确认 `web/dist/` 目录存在，如没有则运行 `cd web && npm run build`。

**Q: Excel 加载项安全警告？**
A: 以管理员运行一次 `npx office-addin-dev-certs install`。

**Q: Key 验证失败？**
A: 检查 Key 格式（应以 `sk-` 开头），确认网络可访问供应商 API。

**Q: 如何添加新工具/SKILL？**
A: 在 `skills/core/` 下新建文件夹，放入 `manifest.json` 定义工具。重启后端自动生效。
