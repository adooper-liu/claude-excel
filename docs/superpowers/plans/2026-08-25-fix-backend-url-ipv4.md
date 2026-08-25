# 后端 URL 收敛 127.0.0.1（修复 IPv6 间歇连不上）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把任务窗格全部硬编码的 `https://localhost:8765` 收敛为单一常量 `https://127.0.0.1:8765`，消除 IPv6 解析导致的间歇性「后端连不上」。

**Architecture:** 新增 `addin/src/services/api-config.ts` 导出 `API_BASE`（单一真相），前端 10 个文件改为从它取基地址。后端只监听 IPv4 `127.0.0.1`（[server.py:762-770](backend/server.py#L762-L770)），本机 `localhost` 优先解析为 `::1`，WebView2 走 `::1` 时连接挂死（SYN_SENT），fetch 抛 `Failed to fetch` → 任务窗格显示「后端连不上」（[App.tsx:474](addin/src/taskpane/components/App.tsx#L474)）。改走 127.0.0.1 后完全绕开 IPv6。证书 SAN 已确认同时覆盖 `127.0.0.1` 与 `localhost`，不受影响。

**Tech Stack:** TypeScript（React 任务窗格），相对路径 import，webpack/tsc 编译校验。

**Spec:** 本次诊断结论（会话内）：netstat 显示 WebView2 到 `[::1]:8765` 有一条卡死 SYN_SENT；`localhost` 解析顺序为 `::1` 优先；后端仅监听 IPv4。用户已确认方案 1：**前端统一改 127.0.0.1，可收敛成一个常量**。不改 manifest.xml / webpack.config.js / launch.bat / server.py（任务窗格宿主 URL 保持 localhost，后端 CORS 已允许 localhost 两个源，跨源 fetch 无需后端改动）。

## Global Constraints

- 改动范围**只限 `addin/src`**（前端 fetch 目标 + 错误提示 + 设置默认值）。不改 `addin/manifest.xml`、`addin/webpack.config.js`、`backend/server.py`、`launch.bat`、`scripts/`、`docs/`。
- 基地址常量：`"https://127.0.0.1:8765"`（必须带 `https://`，不带尾斜杠）。
- 后端「只绑 127.0.0.1」架构约定不变。
- 每个 Task 完成后跑 `cd addin && npm run typecheck` 验证无类型错误。
- 不改任何日志文案，除 [App.tsx:474](addin/src/taskpane/components/App.tsx#L474) 错误提示中的 URL 需同步为常量。
- 引号风格跟随各文件现状（单引号 / 双引号）。

---

### Task 1: 新建单一真相常量 `api-config.ts`

**Files:**
- Create: `addin/src/services/api-config.ts`

**Interfaces:**
- Produces: `export const API_BASE: string` —— 全前端后端基地址，值为 `"https://127.0.0.1:8765"`。后续所有 Task 消费它。

- [ ] **Step 1: 创建常量文件**

```ts
/**
 * 后端基地址（单一真相，前端所有后端 fetch 的唯一入口）。
 *
 * 用 127.0.0.1 而非 localhost：本机 localhost 会优先解析成 IPv6 ::1，
 * 而后端只监听 IPv4 127.0.0.1（backend/server.py host="127.0.0.1"）。
 * 走 ::1 的连接无人应答、挂死在 SYN_SENT，导致 fetch 间歇性抛
 * Failed to fetch → 任务窗格显示「后端连不上」。证书 SAN 同时覆盖
 * 127.0.0.1（IP）与 localhost（DNS），此处不受证书影响。
 */
export const API_BASE = "https://127.0.0.1:8765";
```

- [ ] **Step 2: 验证文件可编译**

Run: `cd addin && npx tsc --noEmit --skipLibCheck src/services/api-config.ts --module commonjs --target es2020 2>&1 | Select-Object -First 5`
Expected: 无输出（无类型错误）。

---

### Task 2: 模块级常量文件改用 `API_BASE`（6 个文件）

**Files:**
- Modify: `addin/src/taskpane/components/FetchBar.tsx:22`（`const API = "https://localhost:8765";`，下游 3 处 `API` 引用）
- Modify: `addin/src/taskpane/components/KnowledgeBar.tsx:7`（`const API = ...`，下游 3 处引用；L192-193 是中文文案「API 向量」，**不碰**）
- Modify: `addin/src/excel/recipe-project.ts:3`（`const API = ...`，下游 2 处引用）
- Modify: `addin/src/services/user-skills.ts:47-48`（`API`、`USER_FN_API` 两个常量）
- Modify: `addin/src/services/user-fn.ts:3`（`API`）
- Modify: `addin/src/services/prompt-templates.ts:4`（`TEMPLATES_API`）

**Interfaces:**
- Consumes: `API_BASE`（Task 1）
- Produces: 上述模块不再含 `localhost:8765`，全部经 `API_BASE` 拼接。

- [ ] **Step 1: 改写 6 个文件**

**FetchBar.tsx** —— 删 L22 `const API = "https://localhost:8765";`，在 import 区加：

```ts
import { API_BASE } from "../../services/api-config";
```

三处 `fetch(API + ...)` → `fetch(API_BASE + ...)`（L25、L112、L194）。其中 L112/L194 形如：

```ts
fetch(API + "/api/fetch-recipe?url=" + encodeURIComponent(target));
```

→ 仅把 `API` 换成 `API_BASE`，其余不变。

**KnowledgeBar.tsx** —— 删 L7 `const API = ...;`，加：

```ts
import { API_BASE } from "../../services/api-config";
```

L39、L52、L69 三处 `fetch(API + path...)` → `fetch(API_BASE + path...)`。L192-193「API 向量」中文文案不动。

**recipe-project.ts** —— 删 L3 `const API = ...;`，加：

```ts
import { API_BASE } from "../services/api-config";
```

L63、L88 两处 `fetch(API + "/api/fetch-recipe/project?" + params.toString())` → `fetch(API_BASE + "/api/fetch-recipe/project?" + params.toString())`。

**user-skills.ts** —— 加：

```ts
import { API_BASE } from "./api-config";
```

L47-48 改为：

```ts
const API = API_BASE + "/api/user-skills";
const USER_FN_API = API_BASE + "/api/user-fn";
```

文件内其余 `API` 引用不变。

**user-fn.ts** —— 加：

```ts
import { API_BASE } from "./api-config";
```

L3 改为：

```ts
const API = API_BASE + "/api/user-fn";
```

**prompt-templates.ts** —— 加：

```ts
import { API_BASE } from "./api-config";
```

L4 改为：

```ts
export const TEMPLATES_API = API_BASE + "/api/templates";
```

- [ ] **Step 2: 验证类型**

Run: `cd addin && npm run typecheck`
Expected: 退出码 0，无 `error TS`。

- [ ] **Step 3: 确认无残留**

Run: `cd addin && rg "localhost:8765" src --glob "*.ts" --glob "*.tsx" -l`
Expected: 列出 `claude.ts`、`SettingsPanel.tsx`、`skill-handlers.ts`、`App.tsx`（留给 Task 3/4/5），**不含**本 Task 的 6 个文件。

---

### Task 3: AI 代理默认 URL（claude.ts + SettingsPanel.tsx）

**Files:**
- Modify: `addin/src/services/claude.ts:47`（`let proxyBaseUrl = 'https://localhost:8765';`）
- Modify: `addin/src/taskpane/components/SettingsPanel.tsx:60,165`（`useState('https://localhost:8765')` 与 `placeholder`）

**Interfaces:**
- Consumes: `API_BASE`
- Produces: `proxyBaseUrl` 初始值、设置面板默认值/占位符均为 `API_BASE`（`proxyBaseUrl` 仍保持可被 `setProxyUrl` 覆盖的运行时语义）。

- [ ] **Step 1: 改写 2 个文件**

**claude.ts** —— 加：

```ts
import { API_BASE } from "./api-config";
```

L47 改为：

```ts
let proxyBaseUrl = API_BASE;
```

**SettingsPanel.tsx** —— 加：

```ts
import { API_BASE } from "../../services/api-config";
```

L60 改为：

```ts
const [proxyUrl, setProxyUrl] = useState(API_BASE);
```

L165 改为：

```tsx
placeholder={API_BASE}
```

- [ ] **Step 2: 验证类型**

Run: `cd addin && npm run typecheck`
Expected: 退出码 0，无 `error TS`。

---

### Task 4: skill-handlers.ts 内联 fetch（4 处）

**Files:**
- Modify: `addin/src/services/skill-handlers.ts:411,425,463,487-492`

**Interfaces:**
- Consumes: `API_BASE`
- Produces: `web_fetch`、`search_knowledge`、`save_structure_note`、`load_structure_notes` 四个 handler 的 fetch 目标改为 `API_BASE`。

- [ ] **Step 1: 改写 4 处内联 URL**

加 import：

```ts
import { API_BASE } from "./api-config";
```

精确替换（保持引号风格，文件内为单引号）：

- L411 `'https://localhost:8765/api/web-fetch'` → `API_BASE + '/api/web-fetch'`
- L425 `'https://localhost:8765/api/knowledge/search'` → `API_BASE + '/api/knowledge/search'`
- L463 `'https://localhost:8765/api/table-structure'` → `API_BASE + '/api/table-structure'`
- L487-492：

```ts
r = await fetch(
  'https://localhost:8765/api/table-structure?fileKey=' +
    encodeURIComponent(fileKey) +
    '&sheet=' +
    encodeURIComponent(sheet)
);
```

→ 第一段改为 `API_BASE + '/api/table-structure?fileKey=' +`，其余行不变。

- [ ] **Step 2: 验证类型**

Run: `cd addin && npm run typecheck`
Expected: 退出码 0，无 `error TS`。

---

### Task 5: App.tsx 内联 fetch + 错误提示（5 fetch + 1 提示）

**Files:**
- Modify: `addin/src/taskpane/components/App.tsx:191,282,289,474,570,615`

**Interfaces:**
- Consumes: `API_BASE`
- Produces: `knownTableMarkerLine`、`/api/config` 探测、`/api/web-ingest/pending|ack` 的 fetch 目标改为 `API_BASE`；L474 错误提示用模板字符串拼 `API_BASE`。

- [ ] **Step 1: 改写 6 处**

加 import：

```ts
import { API_BASE } from "../../services/api-config";
```

精确替换（文件内混用单/双引号，保持原样，只换 URL 段）：

- L191 `'https://localhost:8765/api/table-structure/all?fileKey=' +` → `API_BASE + '/api/table-structure/all?fileKey=' +`
- L282、L289 `'https://localhost:8765/api/config'` → `API_BASE + '/api/config'`（两处）
- L474：

```ts
? '后端连不上（https://localhost:8765）。请先运行 launch.bat，或单独执行：python backend/server.py'
```

→

```ts
? `后端连不上（${API_BASE}）。请先运行 launch.bat，或单独执行：python backend/server.py`
```

- L570 `"https://localhost:8765/api/web-ingest/pending"` → `API_BASE + "/api/web-ingest/pending"`
- L615 `"https://localhost:8765/api/web-ingest/ack"` → `API_BASE + "/api/web-ingest/ack"`

- [ ] **Step 2: 验证类型**

Run: `cd addin && npm run typecheck`
Expected: 退出码 0，无 `error TS`。

---

### Task 6: 最终验证 + 提交

**Files:**
- Verify: `addin/src` 无 `localhost:8765` 残留
- Verify: `cd addin && npm run typecheck && npm run build`
- Verify: `git status` 只含本计划改动文件 + 计划文档

- [ ] **Step 1: 残留扫描**

Run: `cd addin && rg -n "localhost:8765" src`
Expected: **无输出**（src 下零残留）。

- [ ] **Step 2: 类型检查 + 生产构建**

Run: `cd addin && npm run typecheck && npm run build`
Expected: 两命令退出码 0；`npm run build` 产物进入 `addin/dist/`（已被 gitignore，不影响 git）。

- [ ] **Step 3: 复核 git 改动范围**

Run: `git status --short`
Expected: 仅 `addin/src/` 下 10 个文件 + 新增 `addin/src/services/api-config.ts` + 本计划文档 `docs/superpowers/plans/2026-08-25-fix-backend-url-ipv4.md`。无 manifest/webpack/backend 改动。

- [ ] **Step 4: 提交**

```bash
git add addin/src/services/api-config.ts \
  addin/src/taskpane/components/FetchBar.tsx \
  addin/src/taskpane/components/KnowledgeBar.tsx \
  addin/src/excel/recipe-project.ts \
  addin/src/services/user-skills.ts \
  addin/src/services/user-fn.ts \
  addin/src/services/prompt-templates.ts \
  addin/src/services/claude.ts \
  addin/src/taskpane/components/SettingsPanel.tsx \
  addin/src/services/skill-handlers.ts \
  addin/src/taskpane/components/App.tsx \
  docs/superpowers/plans/2026-08-25-fix-backend-url-ipv4.md
git commit -m "fix(frontend): 后端 URL 收敛 127.0.0.1，绕开 localhost 的 IPv6 挂起"
```

Expected: 提交成功，`git log -1` 可见。
