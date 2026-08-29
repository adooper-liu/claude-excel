---
status: done
---
install.bat 一键自足：补 npm install + npm run build（2026-08-28）
<system-reminder>This file content continuation follows the established plan template in this repo.</system-reminder>
# install.bat 一键自足：补 npm install + npm run build（2026-08-28）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox（`- [ ]`）syntax.

**Goal:** install.bat 补齐生产模式硬前置——`npm install` + `npm run build`。理由：`backend/server.py:69` 生产托管 `ADDIN_DIR = <repo>/addin/dist/`，`:328-329` 从 dist 挂 assets，`:837-839` 从 dist 找 taskpane 文件；CLAUDE.md「npm run build 后清单改指向 :8765、后端托管 dist」。install.bat 作为「首次安装」入口漏了这步 → 服务装好了但 Excel 从 :8765 拉的 taskpane 是缺失/旧的。

## Global Constraints

- **只改 `install.bat`**。不碰 addin 源码、`backend/server.py`、`scripts/service/*`、`.gitignore`。
- **顺序强制**：先 `npm install` 再 `npm run build`（webpack 是 devDependency，build 前 node_modules 必须存在）。
- **失败中断**：npm install / npm run build 失败都 `exit /b 1`（与现有证书段 `if %ERRORLEVEL% neq 0` 风格一致）——生产模式下 :8765 无 dist = Excel 白屏，是硬依赖，不是 soft-warning。
- **边界（不做）**：不改 manifest 的 URL 指向（:3000→:8765）；不动 Wef 注册方式；不加服务自动安装。那是独立主题，本次只补 build 两步。
- **dist 不入仓库**：`addin/dist/` 已被 `.gitignore`（“# Build output → addin/dist/”）覆盖，build 后 git 状态保持干净，不提交 dist。
- 保持 install.bat 既有结构（`chcp 65001`、`cd /d "%~dp0"`、编号段、结尾 pause 与服务提示）。

---

### Task 1: install.bat 插入 npm install + npm run build 段

**Files:**
- Modify: `install.bat`

**Interfaces:**
- Produces: `addin/node_modules/`（install）+ `addin/dist/`（webpack production build）。
- Consumes: 本机 node/npm（证书段已依赖 npx，同一前提）。
- 现状：install.bat 现为 3 段——[1] 证书（npx office-addin-dev-certs install + copy pem/key）、[2] pip install + playwright install chromium、[3] 注册加载项 HKCU\Wef + 服务提示文字。

- [ ] **Step 1: 插入构建段并重排编号** — 将 install.bat 的第 1/2/3 段重排为 1/2/3/4，在第 1 段（证书）与第 2 段（pip）之间插入：

```bat
echo.
echo [2/4] 安装并构建 addin 前端（生产模式下后端从 :8765 托管 addin\dist）...
cd addin
call npm install
if %ERRORLEVEL% neq 0 (
    echo npm install 失败，请确认已安装 Node.js
    cd ..
    exit /b 1
)
call npm run build
if %ERRORLEVEL% neq 0 (
    echo npm run build 失败 → 后端 :8765 将无法提供 taskpane（生产模式不可用）
    cd ..
    exit /b 1
)
cd ..
echo 前端 dist 已构建。
```

原有 [1]→`[1/4]`、原 [2]（pip+chromium）→`[3/4]`、原 [3]（注册）→`[4/4]`，段内内容与顺序不变。结尾的服务提示与 pause 保留。

- [ ] **Step 2: 验证** — 
  - 在项目根跑 `cmd /c install.bat`（或手动 cd addin && npm install && npm run build）。
  - Expected: `addin/dist/` 存在且含 taskpane html/js；git status 干净（dist 被 .gitignore 覆盖，node_modules 同理）；`addin/manifest.xml` 未被本次改动。
- [ ] **Step 3: 提交** —
  `git add install.bat && git commit -m "feat(install): 一键安装补 npm install + npm run build（生产托管 addin/dist 硬前置）"`

---

## 收尾

1. Run: `cd addin && npm run typecheck` → 无类型错误（确认 build 前源码健康，非本次改动的产物）。
2. 手动：install.bat 全流程跑通 → 证书 + node_modules + dist + pip + chromium + 注册完成；`addin/dist/` 存在。
3. 边界确认：manifest URL 仍指 `:3000`（dev 模式）——本次不动，生产切换另开任务。
4. 全部通过后：按 `docs/coordination.md`，实现完成，review 交给 Claude 对照本 plan 逐粒核对。
