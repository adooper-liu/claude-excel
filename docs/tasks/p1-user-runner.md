# 任务：P1 用户本地函数（user.* runner + 注册表）

## 交接指令（复制给 Cursor，不用手敲）

> `docs/tasks/p1-user-runner.md` · `feat/p1-user-runner` · `d75f4f8`

```bash
git checkout master && git pull && git checkout -b feat/p1-user-runner
```

> hash 指向本 brief 落库 commit；后续改动用 `git log -1 --format=%h` 回填，或直接跑上面命令（`git pull` 已保证最新）。
> Claude Code × Cursor 的唯一交接载体。禁止在聊天里互贴长方案；另一方 `git pull` 后读此文件。

- **分支**：`feat/p1-user-runner`（本 brief 阶段先落 master，Cursor 开此分支写代码）
- **状态**：`design`
- **主责（当前阶段）**：Claude Code（design）→ Cursor（coding）

## 目标

让用户 Pack 能携带**本机 Python 函数**（`user.*`），在本机后端以「子进程 + 超时 + 信任门」隔离执行，通过独立命名空间暴露给加载项对话。这是首个「用户扩展带可执行代码」的形态。核心安全边界已定稿于 `docs/user-extensions-security.md`，本任务照其 §8 落码。

## 边界 / 不做

（均引用 `CLAUDE.md` 与 `docs/user-extensions-security.md`）

- **物理隔离，零改动核心锁步**：`user.*` 走独立注册表，**不进** `addin/src/services/skill-registry.ts` 的 `HANDLED_TOOLS`、**不进** `addin/src/services/skill-handlers.ts` switch、**不进** `backend/skill_registry.py` 的 `ADDIN_HANDLERS`。三方锁步校验仍只查核心 manifest（`backend/skill_registry.py:60` `validate`）。
- **主 LLM key 永不进函数**：不 env、不入参、cwd 不指向 config 目录（`backend/config_store.py:7` `CONFIG_DIR`）。三处都断。
- **不写格**：`user.*` 不直接写 Excel；写格仍唯一走核心 Office JS 算子（`CLAUDE.md` 写格路径）。
- **不做**：OS 级沙箱 / 容器 / 独立低权限账户、函数间共享状态 / 常驻进程、网络硬隔离（v1 边界，安全文档 §7）。
- **不新增无执行器的核心工具名**：不违反「manifest 没有 executor 启动即失败」纪律；不恢复 `industry-workflows.ts`。

## 验收

- [ ] 后端 `python -m pytest backend/tests` 全绿（含新增 `test_user_fn_runner.py`）
- [ ] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [ ] 任务特有条目：
  - [ ] `user.*` 工具名**不在** `HANDLED_TOOLS` / `ADDIN_HANDLERS` 中（启动校验不报 + 测试断言）
  - [ ] 子进程 clean_env 下取不到 `DEEPSEEK_API_KEY` / `ANTHROPIC_AUTH_TOKEN`（测试断言）
  - [ ] 能力声明哈希变化 → 拒绝执行 + 提示重新授权（测试断言）
  - [ ] 非法函数名（不匹配 `^user\.[a-z][a-z0-9_]*$`）不进注册表 / 拒绝执行
  - [ ] 示例 `user.profit_assumptions`（纯计算、`network:false`、无 secrets）跑通并返回合法 JSON

## 方案（Claude Code 填，design 阶段）

依据 `docs/user-extensions-security.md` §8「P1 实施清单（最小闭环）」。§8 未写死的 4 个落点由本 brief 裁定（见下），其余照 §8 执行。

### 设计待定点（Claude Code 已裁定，Cursor 照做）

1. **运行时扩展目录**：新增 `~/.claude-excel-web/packs/{pack-id}/extensions/{ext-name}/`（含 `manifest.json` + `handler.py`）。安装时 `install_pack` 把 `samples/packs/{pack-id}/extensions/*` 复制过去，与 `skills/` 并列、**不进 `skills/`**。注册表扫 `~/.claude-excel-web/packs/*/extensions/*/manifest.json`（§4 一致）。
2. **`pack.json` 增 `extensions[]` 声明**，与 `skills[]` 同款「声明 vs 磁盘一致」校验（参考 `backend/user_packs_store.py:169-175`）。
3. **`installed_packs.json` schema 扩展**：由 `[{"id","installedAt"}]` 扩为含 `version`、`capabilityHash`、`consentedAt`（§5 能力变化重同意）。向后兼容旧记录：缺 `capabilityHash` 按「未授权本地函数」处理、不执行。
4. **安装同意 UI**：任务窗格 pack 安装前，若含 `extensions`，弹「此 pack 含 N 个本机函数（可联网 / 会读取密钥）」确认；同意才写 `installed_packs.json` 的 `capabilityHash`（§5，P1 轴心）。

### 新增后端文件

| 文件 | 职责 |
|---|---|
| `backend/user_extension_registry.py` | 扫 `~/.claude-excel-web/packs/*/extensions/*/manifest.json`；校验 manifest schema（`name` 匹配 `^user\.[a-z][a-z0-9_]*$`、`entry`、`params`、`returns`、`network`、`secrets`、`timeoutMs`）；计算能力声明哈希（`name+network+secrets` 规范化后哈希） |
| `backend/user_fn_runner.py` | `subprocess.run([sys.executable, handler.py], cwd=扩展目录, stdin/stdout/stderr=PIPE, timeout=min(声明,20s), env=clean_env)`；全局 `asyncio.Semaphore(2)` 并发上限；stdout 单 JSON 解析、>64KB 截断报错；参数只走 stdin JSON；`ce_http` 助手走 `web_tools.safe_http_url` |
| `backend/extension_secrets.py` | 读写 `~/.claude-excel-web/extension-secrets.json`（不在 pack 目录）；仅当 `manifest.secrets` 声明时按名注入 `CE_SECRET_<UPPER>` env |

### 改后端

- `backend/server.py`：新增 `GET /api/user-fn`（list）、`POST /api/user-fn/{name}`（执行）、`POST /api/user-fn/{name}/secret`（写密钥），全部 `require_loopback(request)`（沿用 `server.py:245`）。
- `backend/user_packs_store.py`：`install_pack` 扩展 `extensions[]` 复制 + `installed_packs.json` schema 扩展。

### 改前端 addin

- `addin/src/services/skill-loader.ts` `getAllTools()`：核心 tools 之后**追加** `user.*`（从 `GET /api/user-fn` 拉取，前缀 + 描述「本机函数」）。注意 `getAllTools()` 有 `cachedTools` 缓存，追加逻辑要落在缓存之后。
- `addin/src/taskpane/components/App.tsx` `onToolUse`（现 `App.tsx:313`）：先 `startsWith("user.")` → `fetch POST /api/user-fn/{name}`，否则走 `executeHandler`。参考现有 `web_fetch`/`search_knowledge` 的 fetch 模式（`skill-handlers.ts:263-287`）。
- 安装同意 UI：`addin/src/taskpane/components/App.tsx:581` `onInstallPack` → `installPack`（`addin/src/services/user-skills.ts:141`）。

### 示例与测试

- 示例 `user.profit_assumptions`（纯计算、`network:false`、无 secrets）放 `samples/packs/` 下对应 `extensions/` 目录。
- `backend/tests/test_user_fn_runner.py`：clean_env 无 key、stdin/stdout 协议、超时、非法名、`network` 声明、能力哈希变化拒绝。

### 关键约束（写码时反复核对）

- 复用 `web_tools.safe_http_url`（`backend/web_tools.py:187`）做 `ce_http` 的 URL 校验。
- 子进程先例：`backend/web_browser.py`（Playwright）已是子进程级隔离。
- clean_env 基线：清空 `os.environ` 后仅保留必要项（`SYSTEMROOT`/`PATH`/`TEMP` 等），**绝不透传** `DEEPSEEK_API_KEY` / `ANTHROPIC_AUTH_TOKEN`。
- 函数自身密钥单独存 `extension-secrets.json`，分享 pack 不带出密钥；SKILL 正文永不写密钥。

## Review notes（Claude Code 填，review 阶段，只读不改代码）

（待 coding 阶段后填）

## 进度 log（谁改谁 append，一行一条）

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-16 | design | Claude Code | `—` | 初稿 brief（目标/边界/验收/方案 + 4 个设计待定点裁定） |
