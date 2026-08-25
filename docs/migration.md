# 迁移到新机台（Windows + Office）

> **消费者**：需要把 SheetWise 装到另一台 Windows 机器的人（换机 / 新同事）。
> **何时读**：迁移前对照执行。
> **怎么用**：按步骤走，跳过「前提」中已具备的项。

**本指南是 README「快速启动」的增量**：基础安装（Node / Python / Excel、`install.bat`）以 README 与 `install.bat` 为准，这里只补「带数据走」和「机台相关重建」。同一事实不复制两处。

## 前提（新机台）

- Windows + Excel（Office JS 加载项的硬边界，非本项目限制）
- Node.js `>=20 <25`、npm `>=9 <12`、Python 3

## 迁移流程

### 1. 装代码

```bash
git clone git@github.com:adooper-liu/sheetwise.git
cd sheetwise/addin
npm install
npm run build
```

### 2. 重建机台相关项（不能拷贝，每台机独立）

管理员运行 `install.bat`，它一次完成：
- 生成并信任 Office 开发者证书（`backend/cert.pem` + `backend/key.pem`）
- 安装 Python 依赖 + Playwright Chromium
- 把本机 `addin/manifest.xml` 路径注册进 `HKCU:\SOFTWARE\Microsoft\Office\16.0\Wef\Developer\`

### 3. 迁用户数据（旧机台 → 新机台）

拷贝整个 `~/.claude-excel-web/` 目录到新机台同名位置（Windows 为 `%USERPROFILE%\.claude-excel-web\`）：

| 内容 | 说明 |
|---|---|
| `config.json` | 各 provider 的 API Key、baseUrl、model。**敏感**——用安全通道传，勿进 git |
| `skills/` `knowledge/` | 已装技能、本机知识库 RAG |
| `packs/` `installed_packs.json` | 已装场景包 |
| `templates.json` `fetch-recipes/` | 提示词模板、取数 recipe |

> 环境变量 `DEEPSEEK_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 若在用，一并迁移；环境变量优先级高于文件配置。

### 4. 装浏览器扩展（取数用）

`chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `extension/` 目录。

### 5. 验证

1. 双击 `launch.bat`：后端 :8765 起来、Excel 侧边栏出现 SheetWise
2. 侧边栏 ⚙ 配置 / 校验 Key，聊一句
3. 扩展弹窗「检测本机后端」返回正常

## 边界与风险

- **机台耦合只有四处**：开发者证书、加载项注册表、Playwright 浏览器、浏览器扩展——全是「重跑 / 重装」可解决，代码里 0 处硬编码本机路径（后端用 `Path(__file__)` 相对解析，用户数据用 `Path.home()`）。
- **`config.json` 含 API Key**：迁数据走安全通道，别打进 zip 提交到 git。
- 旧机台先保留一份 `~/.claude-excel-web/` 备份再动手。
