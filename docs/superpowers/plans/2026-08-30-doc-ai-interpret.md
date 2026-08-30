---
status: pending
---
# 文档 AI 结构化解读（doc-interpret：OCR 字面 → 模型含义 → 落表）（2026-08-30）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OCR/布局管线（字面层）之上加**语义解读层**：把识别出的 `raw_text`/`rows` 交给已配置的模型，返回**文档无关的结构化 JSON**（`kvs`/`items`/`totals`/`notes`），前端可展示并在新 Sheet 落表。字段名跟随文档原文，**不硬编码任何业务字段**；模型只读 OCR 输出，不参与模板存储/管理。

**Architecture:** 复用现有 `ai_proxy.chat_complete`（已接 provider/密钥）。新模块 `doc_interpret.py` 负责「提示词 + 调模型 + 提取文本 + JSON 校验/归一」；server 加 `POST /api/doc/interpret`；前端在「解析完成」卡片上加「AI 解读」按钮，结果可「解读进工作簿」。

```
解析完成（已有）→ 卡片：AI 解读 → POST /api/doc/interpret {ocrText, rows}
  → chat_complete(通用 system prompt) → 模型返回 JSON
  → parse/校验 → {kvs[], items[], totals[], notes[]}
  → 前端展示摘要 + 「解读进工作簿」（writeToNewSheet）
```

**Context / 已核实事实（不要重测）：**

- `ai_proxy.chat_complete(messages, system_prompt=None, model=None, max_tokens=4096, tools=None) -> dict` 是 async，返回 Anthropic 风格 `{content:[{type:"text",text}]}`；无 key 时 content 文本以 `Error:` 开头。`ai_proxy.get_api_key()`/`get_base_url()` 已接 config。
- `extract_pdf` 图片/PDF 均产出 `text`（OCR 原文）与 `rows`；`/api/pdf/extract` 直接透传。
- 前端 `PdfAttachSection.tsx`：`pendingResult`（含 `text`/`rows`/`sheets`/`proposedRecipe`）；卡片已有「入知识库/进工作簿/据此生成模板」按钮；`writeToNewSheet(sheetName, values)` 在 `addin/src/excel/write.ts`。
- `require_loopback` 路由模式、`@app.post` JSON body 路由（如 `/api/web-ingest`）可仿。
- CLAUDE.md 纪律：写格唯一通道 Office JS；字段名是用户侧数据；模型不硬编码业务口径；文档内容给模型前需用户知情（复用「云确认」心智：显式按钮触发）。

## Global Constraints

- **模型只读 OCR 输出**：`/api/doc/interpret` 只收 `ocrText`（+可选 `rows`），不收模板、不写存储。
- **通用提示词，不写业务**：字段名/键名来自文档原文；禁止在提示词或代码里写死「发票号/金额/税率」等字段。
- **不臆造**：提示词强约束「只整理 OCR 里明确出现的字段，疑似错字进 notes」。
- **写格只走 Office JS**：后端只返回 JSON，落表由前端 `writeToNewSheet`。
- **优雅降级**：无 API key / 模型报错 / JSON 解析失败 → 明确 400 错误，不影响纯 OCR 路径。

---

### Task 1: 后端 `doc_interpret.py` + 路由

**Files:**
- Create: `backend/doc_interpret.py`
- Create: `backend/tests/test_doc_interpret.py`
- Modify: `backend/server.py`
- Modify: `backend/tests/test_doc_recipe_api.py`（或新建 interpret API 测试，放同一文件）

**Interfaces:**
- Produces: `SYSTEM_PROMPT`；`build_interpret_messages(ocr_text, rows=None)`；`parse_interpret_json(raw) -> {kvs, items, totals, notes}`；`async interpret_document(ocr_text, *, rows=None, model=None, model_call=ai_proxy.chat_complete) -> dict`；`POST /api/doc/interpret`（require_loopback，body `{ocrText, rows?}`）。
- Consumes: `ai_proxy.chat_complete`。

**现状缺陷：** 无语义解读层；OCR 结果不喂模型。

- [ ] **Step 1: 模块** — `build_interpret_messages`（system=通用提示词：只整理原文字段/不臆造/错字进 notes/只输出 JSON；user=OCR 文本+可选 rows JSON）。
- [ ] **Step 2: 解析** — `_extract_text`（兼容 Anthropic `content[]` 与 OpenAI `choices[].message.content`）；`parse_interpret_json`（去 markdown 围栏、`json.loads`、shape 校验：kvs/totals 为 label/value 数组、items 为 columns+rows 数组、notes 为字符串数组；非法抛 `ValueError`）。
- [ ] **Step 3: 主函数** — `interpret_document`：调 `model_call(messages, system_prompt=SYSTEM_PROMPT, model=model)` → 提取文本 → 空/`Error:` 开头抛 `ValueError` → `parse_interpret_json`。
- [ ] **Step 4: 路由** — `POST /api/doc/interpret`：`ocrText` 必填（空 → 400「ocrText 必填」）；`rows` 非列表忽略；`ValueError` → 400。
- [ ] **Step 5: 单测** — `test_doc_interpret.py`：提示词含「不臆造」且 user 含 OCR 文本；`parse_interpret_json` 正常/围栏/非法 JSON/形状错；`interpret_document` 用注入 `model_call` 验成功与 `Error:` 抛错。API 测试：mock `doc_interpret` 的 model_call → 200 返回 `{kvs,items,totals,notes}`；空 ocrText → 400。`pytest tests/ -q` → exit 0。

---

### Task 2: 前端「AI 解读」+ 解读落表

**Files:**
- Modify: `addin/src/taskpane/components/PdfAttachSection.tsx`
- Modify: `addin/src/taskpane/taskpane.css`（如需少量样式）

**Interfaces:**
- Produces: 解析完成卡片新增「AI 解读」按钮（有 `text` 时显示）；点击调 `POST /api/doc/interpret`；结果显示摘要（kvs/items/totals/notes 数量与要点）；「解读进工作簿」把结果写新 Sheet。
- Consumes: `POST /api/doc/interpret`、`writeToNewSheet`。

**现状缺陷：** 解析卡片无 AI 解读入口。

- [ ] **Step 1: 状态** — `interpretResult`/`interpretBusy`/`interpretErr`；类型 `InterpretResult = { kvs:{label,value}[]; items:{columns:string[];rows:(string|number)[][]}[]; totals:{label,value}[]; notes:string[] }`。
- [ ] **Step 2: 按钮** — 卡片里 `pendingResult.text` 存在时显示「AI 解读」；点击 POST `{ocrText: text, rows}`；失败 `setInterpretErr`。
- [ ] **Step 3: 摘要展示** — kvs 数量、items 各表行列数、totals、notes 前几条；可折叠或直接展示文本。
- [ ] **Step 4: 落表** — 「解读进工作簿」：拼一个 Sheet（kvs 字段/值两列；items 每表一个表头+数据块；totals 字段/值；notes 备注列），`writeToNewSheet(sheetName + "-解读", rows)`。
- [ ] **Step 5: 门禁** — `npm run typecheck` → exit 0；`npm run test:unit` → 全绿；`npm run build` → exit 0。

---


---

### Task 3: AI 辅助建模板（propose-recipe，解决启发式模板不友好）

**Files:**
- Modify: `backend/doc_interpret.py`
- Modify: `backend/tests/test_doc_interpret.py`
- Modify: `backend/server.py`
- Modify: `backend/tests/test_doc_recipe_api.py`
- Modify: `addin/src/taskpane/components/PdfAttachSection.tsx`

**Interfaces:**
- Produces: `RECIPE_SYSTEM_PROMPT`；`build_recipe_messages`；`parse_recipe_json -> {fields, notes}`；`async propose_recipe_ai(ocr_text, *, rows=None, base_name="", model=None, model_call=None) -> {name, description, fields, notes}`；`POST /api/doc/propose-recipe`（require_loopback）；前端「AI 生成模板」按钮。
- Consumes: `ai_proxy.chat_complete`、`layout_doc.normalize_key`。

**现状缺陷：** 启发式 `propose_recipe` 会把 OCR 碎片/噪声当字段（购/名/BR），模板不友好。

- [ ] **Step 1: 提示词** — 让模型整理干净字段字典：每项 `{name, type, source, group}`；type 限 `text|number|date|amount|percent`，group 限 `header|detail`；OCR 碎片合并（购/名→购买方名称）、纯噪声丢弃；只输出 JSON。
- [ ] **Step 2: 归一化** — `_normalize_recipe_field`（type/group 白名单、source 空回退 name、字段名过滤冒号/纯符号）、`parse_recipe_json`（去围栏、按 `normalize_key` 去重、notes）。
- [ ] **Step 3: 主函数 + 路由** — `propose_recipe_ai`（注入 model_call；空/`Error:` 抛 ValueError）；`POST /api/doc/propose-recipe`（`ocrText` 必填，`rows?`/`baseName?`；ValueError→400）。
- [ ] **Step 4: 单测** — 提示词含「碎片」；parse 正常/噪声丢弃/type、group 默认/去重；注入 call 成功与 Error；API 200/400。
- [ ] **Step 5: 前端** — 卡片加「AI 生成模板」按钮（有 `text` 时显示），调 propose-recipe → `onProposeRecipe` 预填 DocRecipeBar。
- [ ] **Step 6: 门禁** — `pytest tests/ -q` → exit 0；`npm run typecheck`/`test:unit`/`build` → 全绿。

## 真机验收（管理员 / 桌面 Excel，不代跑）

沙箱验不到模型真实输出，Codex **禁止声称已验证**，只写「待真机验收」。验收者做：

1. 配好模型 key → 上传那张发票 → 解析完成 → 点「AI 解读」→ 应返回结构化解读（抬头键值/明细/合计/备注），字段名来自文档。
2. 「解读进工作簿」→ 新 Sheet 含 kvs 两列 + 明细表 + 合计，金额为数值可 `=SUM`。
3. 不配 key / 断网 → 点「AI 解读」→ 明确报错提示，OCR 纯流程不受影响。
4. 备注/错字标注：OCR 错字（如大写金额乱码）应在 notes 里说明，不静默改值。

## 收尾

1. `cd backend && python -m pytest tests/ -q` → exit 0。
2. `cd addin && npm run typecheck` → exit 0；`npm run test:unit` → 全绿；`npm run build` → exit 0。
3. 提交（任务分支，每个 Task 一个 commit）：
   - Task 1: `git commit -m "feat(ai): 文档 AI 结构化解读端点（OCR 字面→模型含义→JSON）"`
   - Task 2: `git commit -m "feat(ui): 解析结果 AI 解读 + 解读进工作簿"`
   - Task 3: `git commit -m "feat(ai): AI 辅助建模板（propose-recipe 端点 + 前端按钮）"`
   - plan 文档：`git commit -m "docs(plan): 文档 AI 结构化解读"`
4. 真机验收段留给管理员，Codex 不代跑、不标 done 时声称已验。
5. 全部通过后：按 `docs/coordination.md`，review 交回 Claude 对照本 plan 逐粒核对。