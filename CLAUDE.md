# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

## 项目概述
Claude Excel 是 Excel 加载项：在正在编辑的工作簿里用自然语言读写、格式化、图表。后端只做 LLM 代理、配置和加载项静态资源。没有 Web 前端。

## 核心架构
- **Excel Add-in (`addin/`)**: 主界面。Office JS 操作活工作簿；工具声明在 `addin/skills/core/`。
- **Backend (Python/FastAPI, :8765)**: Anthropic 兼容代理、`config.json`、校验 Skills、托管 `addin/dist`（manifest 指向 `https://localhost:8765/taskpane.html`）。
- **Skills**: 见 `skills/README.md`。声明必须带 executor，否则启动失败。

## Skill 纪律（强制）

**manifest 里没有 executor 的工具，启动即失败。**

- 每个 `tools[].name` 必须有可调用的执行器，并登记在 `HANDLED_TOOLS` 与 `ADDIN_HANDLERS`。
- 后端启动：`backend/skill_registry.py` → `validate_backend_skills`。失败则进程退出。
- 加载项：`addin/src/services/skill-loader.ts` 使用本地 manifest，不请求 pandas 工具清单。
- 禁止为了让服务起来而删除校验，或把未实现工具留在 manifest 里。

## 常用命令

### 后端
- **安装依赖**: `pip install fastapi uvicorn httpx`
- **启动服务**: `cd backend && python server.py` (端口 8765，有证书则 HTTPS)

### Excel 加载项
- **安装依赖**: `cd addin && npm install`
- **启动调试**: `cd addin && npm start`
- **构建**: `cd addin && npm run build`（产物供后端托管）
- **验证清单**: `cd addin && npm run validate`
- **单元测试**: `cd addin && npm run test:unit`

### 综合启动
- **一键启动**: `launch.bat`（后端 + Excel）
- **环境安装**: 管理员运行 `install.bat`

## 开发规范
- **新工具**:
  1. `addin/skills/core/<name>/manifest.json`
  2. `executeHandler` 增加 `case`，名字写入 `HANDLED_TOOLS` 与 `ADDIN_HANDLERS`，并加入 `skill-loader.ts` import
  3. 重启后端；刷新加载项
- **当前主路径**: `inspect_workbook` → `ensure_table` → `reconcile_tables` / `reshape_table` / `calculate_table`。对账、整形、活公式只写新表。
- **配置**: `C:\Users\<User>\.claude-excel-web\config.json`，或加载项设置面板。支持 DeepSeek / 通义千问 / GLM。
- **Add-in**: Office JS；UI 用 FluentUI。
