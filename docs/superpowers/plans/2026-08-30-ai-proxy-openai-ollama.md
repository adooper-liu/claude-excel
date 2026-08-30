---
status: pending
---
# AI 代理 OpenAI 兼容适配 + Ollama 本地模型 + 发票解析默认小快模型（2026-08-30）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `ai_proxy` 支持 **OpenAI 兼容协议**（按 provider `apiStyle` 或 baseUrl 自动识别），从而能接 **Ollama 本地模型**（零成本、无额度、隐私）；发票 AI 解析（interpret / propose-recipe）默认走 `smallFastModel`（配 Ollama 时即本地模型，绕开云 429）；设置 UI 加「Ollama（本机）」预设。

**Architecture:**
- provider 配置加 `apiStyle: "anthropic" | "openai"`（默认 anthropic；baseUrl 主机为 `localhost:11434` / `127.0.0.1:11434` 自动视为 openai）。
- `ai_proxy`：`_headers` / `_payload` / `chat_complete` / `chat_stream` / `fetch_models` / `validate_key` 按 apiStyle 分支：
  - openai：POST `{base}/v1/chat/completions`（无 `x-api-key`/`anthropic-version`；有 key 则 `Authorization: Bearer`）；非流式按 `choices[].message.content` 解析并包装成 Anthropic 形状 `{content:[{type:"text",text}]}`（上层 doc_interpret/`_extract_text` 不用改）；流式解析 SSE `choices[].delta.content`；模型列表 GET `{base}/v1/models`。
- `server.py`：provider validate/save 透传 `apiStyle`；`/api/doc/interpret`、`/api/doc/propose-recipe` 默认 `get_small_fast_model()`（空回退 `get_model()`），响应带 `"model"` 字段。
- `SettingsPanel.tsx`：PRESETS 加 `ollama`（baseUrl `http://localhost:11434`、apiStyle `openai`、apiKey 可为空）；保存/回显 apiStyle；小快模型下拉（已有）可直接选本地模型。

**Context / 已核实事实（不要重测）：**

- `ai_proxy`：`_headers` 固定 `x-api-key`+`anthropic-version`；`chat_complete` POST `{base}/v1/messages` 返回 Anthropic 形状；`chat_stream` 解析 SSE `content_block_delta`；`fetch_models` GET `{base}/v1/models`（带 anthropic 头）；`_api_error_text` 已做 429 友好化（commit 41bf51b）。
- `config_store`：`save_provider(provider_id, data)` 只存 `apiKey/baseUrl/model/smallFastModel`；`get_model()`/`get_small_fast_model()` 支持 env 覆盖（`ANTHROPIC_MODEL`/`ANTHROPIC_SMALL_FAST_MODEL`）；`get_provider_status()` 返回 providers。
- `server.py` provider 路由（约 390-476）：validate/save/set-active/list；`doc_interpret.interpret_document`/`propose_recipe_ai` 默认 `model_call=ai_proxy.chat_complete`、`model=None` → `chat_complete` 内部用 `get_model()`。
- `SettingsPanel.tsx`：PRESETS deepseek/qwen/glm/minimax/custom，均要求 apiKey（「请先填 baseUrl 和 API Key」），保存字段 apiKey/baseUrl/model/smallFastModel；`/api/provider/validate` 拉模型列表。
- Ollama：OpenAI 兼容 `/v1/chat/completions`、`/v1/models`；无需 key。
- 现状痛点：云模型 429 额度（2026-09-04 重置）；发票解析与主对话共用默认模型。

## Global Constraints

- **云路径（anthropic）行为完全不变**：纯新增 openai 分支，默认仍 anthropic。
- **无 key 的 openai provider（Ollama）也能 save/validate/chat**：apiStyle=openai 时 apiKey 可为空。
- **发票解析默认小快模型**：未配 `smallFastModel` 时回退默认模型（行为不变）。
- 模型仍不写业务字段；上游错误继续走 `_api_error_text` 友好化。

---

### Task 1: `ai_proxy` OpenAI 兼容适配

**Files:**
- Modify: `backend/ai_proxy.py`
- Modify: `backend/tests/test_ai_proxy.py`

**Interfaces:**
- Produces: `_is_openai_api(base_url) -> bool`；openai 分支的 `_headers`/`_payload`/`chat_complete`/`chat_stream`/`fetch_models`。
- Consumes: `config_store.get_active_provider`（读 `apiStyle`）。

**现状缺陷：** `ai_proxy` 只讲 Anthropic 协议，无法接 Ollama。

- [ ] **Step 1: 识别** — `_is_openai_api(base_url)`：显式 `apiStyle == "openai"`（读 active provider 配置）或 baseUrl 主机为 localhost/127.0.0.1 且端口 11434 → True。
- [ ] **Step 2: 请求构造** — `_headers(base_url, api_key)` 按 apiStyle：openai 无 anthropic 头、有 key 加 `Authorization: Bearer`；`_payload` openai 分支（system 并成首条 system 消息或 messages 结构，stream/model/max_tokens）。
- [ ] **Step 3: `chat_complete`** — openai 分支 POST `{base}/v1/chat/completions`，解析 `choices[0].message.content` 包装为 `{content:[{type:"text",text}]}`；非 200 走 `_api_error_text`。
- [ ] **Step 4: `chat_stream`** — openai 分支 SSE 解析 `choices[].delta.content`，其它事件忽略。
- [ ] **Step 5: `fetch_models`/`validate_key`** — openai 分支：GET `{base}/v1/models` 无 anthropic 头；空 key 允许。
- [ ] **Step 6: 单测** — `_is_openai_api`（11434 true / dashscope false / apiStyle openai true）；chat_complete openai 返回 choices → 输出 Anthropic 形状；stream delta 拼接；fetch_models openai 请求无 anthropic 头、空 key 不报错；anthropic 路径回归不变。`pytest tests/ -q` → exit 0。

---

### Task 2: config + server（apiStyle 透传 + 发票解析默认小快模型）

**Files:**
- Modify: `backend/config_store.py`
- Modify: `backend/server.py`
- Modify: `backend/tests/test_doc_recipe_api.py`

**Interfaces:**
- Produces: provider 配置含 `apiStyle`；`/api/doc/interpret`、`/api/doc/propose-recipe` 默认小快模型并回传 `model`。
- Consumes: `config_store.get_small_fast_model`/`get_model`。

**现状缺陷：** `save_provider` 丢 `apiStyle`；发票解析用默认模型。

- [ ] **Step 1: `save_provider`** — 白名单加 `apiStyle`；`get_provider_status` 返回 `apiStyle`。
- [ ] **Step 2: provider 路由** — validate/save 请求透传 `apiStyle` 到 `save_provider`。
- [ ] **Step 3: 发票解析默认小快模型** — 两个路由 `model = get_small_fast_model() or get_model()`，传入 interpret/propose；响应加 `"model": model`。
- [ ] **Step 4: 单测** — save/get_provider_status 含 apiStyle；interpret 路由 mock 断言收到 model=smallFastModel、响应含 model；未配 smallFast 回退 get_model。`pytest tests/ -q` → exit 0。

---

### Task 3: 设置 UI Ollama 预设

**Files:**
- Modify: `addin/src/taskpane/components/SettingsPanel.tsx`

**Interfaces:**
- Produces: PRESETS 含 `ollama`；apiStyle 状态/保存/回显；openai 时 apiKey 可为空。
- Consumes: `/api/provider/validate`、save provider。

**现状缺陷：** 无 Ollama 预设、强制 apiKey、不透传 apiStyle。

- [ ] **Step 1: 预设** — PRESETS 加 `ollama: { name: 'Ollama（本机）', baseUrl: 'http://localhost:11434', apiStyle: 'openai' }`；preset 切换同步 apiStyle；custom 可选手动填 apiStyle。
- [ ] **Step 2: 状态与校验** — apiStyle 状态；`apiStyle === "openai"` 时 apiKey 可为空（validate 不强制）；保存请求带 `apiStyle`。
- [ ] **Step 3: 回显** — 加载已配置 provider 时回填 apiStyle。
- [ ] **Step 4: 门禁** — `npm run typecheck` → exit 0；`npm run test:unit` → 全绿；`npm run build` → exit 0。

---

## 真机验收（管理员 / 桌面 Excel，不代跑）

沙箱验不到真实 Ollama/模型输出，Codex **禁止声称已验证**，只写「待真机验收」。验收者做：

1. 装 Ollama → `ollama pull qwen2.5:7b` → `ollama serve`。
2. 设置里选「Ollama（本机）」，model 填 `qwen2.5:7b`，保存 → 对话/发票解析可用，**无 429**。
3. 上传发票 → 「AI 解读」「AI 生成模板」→ 卡片/响应显示模型为 `qwen2.5:7b`（model 字段）。
4. 切回云端 provider → 行为与之前一致（回归）。

## 收尾

1. `cd backend && python -m pytest tests/ -q` → exit 0。
2. `cd addin && npm run typecheck` → exit 0；`npm run test:unit` → 全绿；`npm run build` → exit 0。
3. 提交（任务分支，每 Task 一个 commit）：
   - Task 1: `git commit -m "feat(ai): ai_proxy 支持 OpenAI 兼容协议（Ollama）"`
   - Task 2: `git commit -m "feat(ai): provider apiStyle 透传 + 发票解析默认小快模型"`
   - Task 3: `git commit -m "feat(ui): 设置面板 Ollama 预设"`
   - plan 文档：`git commit -m "docs(plan): AI 代理 OpenAI 兼容 + Ollama 本地模型"`
4. 真机验收段留给管理员，Codex 不代跑、不标 done 时声称已验。
5. 全部通过后：按 `docs/coordination.md`，review 交回 Claude 对照本 plan 逐粒核对。