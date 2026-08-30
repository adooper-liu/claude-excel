---
status: done
---
# 文档识别模板 P0（doc-recipe：文字说明模板 + 数据字典 + 格式清洗 + 手动选模板）（2026-08-30）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一套**文档识别模板（doc-recipe）**，解决「发票/单据格式千差万别，通用启发式覆盖不了」的痛点。用户针对某类单据**手动建模板**：文字说明结构 + 数据字典（字段名/类型/来源/格式规则）+ 参考样例（图片或 PDF）。上传文档时**手动选模板**，后端按模板字段 + 格式规则清洗提取结果。P0 不含框选 UI、不含模板自动建议、不含样例解析。

**Architecture:** 复用既有 recipe 存储模式与提取管线，不新造机制。

- **模板存储**：照抄 [fetch_recipe.py](backend/fetch_recipe.py) 的模式——`CONFIG_DIR / "doc-recipes"`，`save/load/list/delete/validate`，模板名是唯一键。
- **格式清洗**：新后端模块 `format_clean.py`，通用算子（`clean_number`/`clean_date`/`is_null` + `apply_template`），不硬编码任何业务字段。
- **提取接入**：[pdf_extract.py](backend/pdf_extract.py) `extract_pdf` 加可选 `template` 参数，提取表格后按模板字段 + 格式规则清洗 `rows`。
- **前端**：模板管理（增删改名字）+ 上传时选模板。写格仍走 `writeToNewSheet`（Office JS 唯一通道）。

**Context / 已核实事实（不要重测）：**

- `fetch_recipe.py` 的存储模式：`RECIPES_DIR = CONFIG_DIR / "fetch-recipes"`、`save_recipe`/`load_recipe`/`validate_recipe`（`validate_recipe` 做字段白名单 + 归一化）。doc-recipe 照抄这一套。
- 前端已有 [column-format-core.ts](addin/src/excel/column-format-core.ts) 的 `ColumnKind`（`id_text/number/amount/percent/datetime/plain_text`）+ `applyFormatToCell`——但这是**进簿后格式**（Excel 显示格式），不是**提取时清洗**（欧式数字转换、去符号、脏数据判空）。本 plan 的格式清洗是**后端**「提取时清洗」，两者不冲突、不复用，是不同层。
- `extract_pdf(data, ocr_backend, filename)` 已在 [pdf_extract.py](backend/pdf_extract.py)，返回 `{kind, text, rows, sheetName, ...}`。本 plan 加 `template` 参数，仅对 `rows` 应用模板清洗。
- `CONFIG_DIR` 来自 [config_store.py](backend/config_store.py)（`~/.claude-excel-web`，或 `SHEETWISE_USER_HOME` 覆盖）。
- server.py 路由模式：`ingest_router`（`require_loopback`）或 `@app.post`；`POST /api/pdf/extract` 已有（multipart `file` + `ocr_backend` + `cloudConfirmed`）。
- CLAUDE.md 纪律：写格唯一通道 Office JS；算子通用、参数用户自定义、不硬编码业务口径；发票字段（发票号/税额等）是**用户侧模板内容**，不进核心代码、不进内置 schema 白名单。

## Global Constraints

- **不新增核心 skill / 斜杠**：doc-recipe 是后端数据 + 前端 UI 入口，模型不参与模板管理；提取时模型只传 `template` 名。
- **字段是用户数据，不是代码**：模板的 `fields`（品名/金额/税率…）是用户侧 JSON 内容，**禁止**硬编码任何发票业务字段进 `format_clean.py` 或内置 schema。
- **格式清洗是通用算子**：`clean_number`/`clean_date`/`is_null` 只认参数（`numberStyle`/`stripSymbols`/`nullValues`/`dateFormat`），不认「金额」「税率」等业务名。
- **样例只存不解析**：参考样例（图片/PDF）落盘存路径，P0 不做图像/PDF 结构解析。
- **写格只走 Office JS**：清洗后的 `rows` 由前端 `writeToNewSheet` 写格，后端不写格。

---

### Task 1: 后端 `doc_recipe.py` 模板存储（照抄 fetch_recipe 模式）

**Files:**
- Create: `backend/doc_recipe.py`
- Create: `backend/tests/test_doc_recipe.py`

**Interfaces:**
- Produces: `DOC_RECIPES_DIR = CONFIG_DIR / "doc-recipes"`；模板 schema + `save_doc_recipe`/`load_doc_recipe`/`list_doc_recipes`/`delete_doc_recipe`/`validate_doc_recipe`。
- Consumes: `config_store.CONFIG_DIR`。

**现状缺陷：** 无；doc-recipe 全新。

- [ ] **Step 1: 模板 schema**（字段即接口契约，实现必须对齐）：
  ```json
  {
    "name": "增值税发票",
    "description": "通用增值税发票，表头第一行，金额美式数字",
    "fields": [
      {"name": "品名", "type": "text", "source": "数据区第1列"},
      {"name": "金额", "type": "number", "source": "数据区第4列",
       "format": {"numberStyle": "us", "stripSymbols": ["￥"], "nullValues": ["N/A", "-"]}},
      {"name": "开票日期", "type": "date", "source": "抬头右上", "format": {"dateFormat": "%Y/%m/%d"}}
    ],
    "sample": "invoice.png",
    "createdAt": "2026-08-30T00:00:00Z",
    "updatedAt": "2026-08-30T00:00:00Z"
  }
  ```
  `type` ∈ `text|number|date|amount|percent`；`format` 字段白名单：`numberStyle`(`us|eu`)、`stripSymbols`(字符串数组)、`nullValues`(字符串数组)、`dateFormat`(字符串)。`name` 唯一、非空、去首尾空格；`source` 是文字说明（自由文本，≤100 字）。
- [ ] **Step 2: `validate_doc_recipe(raw)`** — 归一化 + 白名单校验：`name` 必填唯一；`fields` 每项 `name`/`type` 必填，`type` 非法 → 报错列合法值；`format` 只保留白名单键，未知键丢弃；`sample` 只存文件名（不含路径，防目录穿越）。仿 `fetch_recipe.validate_recipe` 的归一化风格。
- [ ] **Step 3: 存取函数** — `save_doc_recipe(dict)`（写 `<DOC_RECIPES_DIR>/<name>.json`，更新 `updatedAt`）、`load_doc_recipe(name)`、`list_doc_recipes()`（返回 `[{name, description, fieldCount, updatedAt}]`，不含 fields 全文）、`delete_doc_recipe(name)`（不存在抛 `FileNotFoundError`）。文件名 = 模板名（`name` 含非法文件名字符时安全化，仿 `recipe_host_key` 的字符清洗）。
- [ ] **Step 4: 样例落盘** — 模板可带 `sample`（图片/PDF 字节）。`save_doc_recipe` 时若有 sample 字节，存到 `<DOC_RECIPES_DIR>/samples/<name>.<ext>`，模板里 `sample` 记文件名。P0 **只存不解析**。
- [ ] **Step 5: 单测 `test_doc_recipe.py`** — (a) save/load/list/delete 往返一致；(b) `type` 非法、`name` 空、`fields` 缺 `name` → 报错；(c) 未知 format 键被丢弃；(d) `sample` 带 `../` 被拒。`cd backend && python -m pytest tests/test_doc_recipe.py -q` → exit 0。

---

### Task 2: 格式清洗算子 `format_clean.py`

**Files:**
- Create: `backend/format_clean.py`
- Create: `backend/tests/test_format_clean.py`

**Interfaces:**
- Produces: `clean_number(value, number_style, strip_symbols, null_values)`、`clean_date(value, date_format)`、`is_null(value, null_values)`、`apply_template(rows, template)`。
- Consumes: 无。

**现状缺陷：** 无；数字/日期清洗散落在无 `coerce` 之外，无欧式数字归一化。

- [ ] **Step 1: `is_null(value, null_values)`** — `value` 为 None/空串，或 `str(value).strip()` ∈ `null_values` → True。
- [ ] **Step 2: `clean_number(value, number_style, strip_symbols, null_values)`** — 规则（**本 plan 核心，用户强调的千分位/小数点互换**）：
  - 先 `is_null` → 返回 None。
  - 去 `strip_symbols`（如 `￥`/`€`/`$`）与空白。
  - `number_style == "eu"`：去掉千分位点（`.`）、逗号换成小数点（`,`→`.`），如 `1.234,56` → `1234.56`。
  - `number_style == "us"`：去掉千分位逗号（`,`），如 `1,234.56` → `1234.56`。
  - 最后 `float()`；失败返回 None（脏数据不外抛）。
- [ ] **Step 3: `clean_date(value, date_format)`** — 按 `date_format`（`strptime` 格式）解析；失败返回 None。`date_format` 空则原样返回文本。
- [ ] **Step 4: `apply_template(rows, template)`** — 按 `template.fields` 顺序：若 `fields` 有 N 列，取 `rows` 前 N 列；对每列按 `field.type` + `field.format` 调对应清洗；表头行 = `fields[].name`。返回清洗后的 `rows`（表头 + 数据）。`fields` 列数多于 `rows` 列数时，缺失列补空，不报错。
- [ ] **Step 5: 单测 `test_format_clean.py`** — 重点覆盖：`clean_number("1.234,56", "eu", ["€"]) == 1234.56`、`clean_number("1,234.56", "us", []) == 1234.56`、`clean_number("N/A", "us", [], ["N/A"]) is None`、`clean_date("9/4/2018", "%m/%d/%Y")` 正确、`apply_template` 表头+清洗对齐。`cd backend && python -m pytest tests/test_format_clean.py -q` → exit 0。

---

### Task 3: 接入提取管线 + API

**Files:**
- Modify: `backend/pdf_extract.py`（`extract_pdf` 加 `template` 参数）
- Modify: `backend/server.py`（doc-recipes CRUD + `/api/pdf/extract` 加 `template` 字段）

**Interfaces:**
- Produces: `extract_pdf(data, ocr_backend, filename, template=None)` 在表格分支对 `rows` 调 `apply_template`；`GET/POST/DELETE /api/doc-recipes`；`POST /api/pdf/extract` 表单加 `template`（模板名）。
- Consumes: `doc_recipe.load_doc_recipe`、`format_clean.apply_template`。

**现状缺陷：** 无；提取不认模板。

- [ ] **Step 1: `extract_pdf` 接模板** — 加 `template: dict | None = None` 参数；仅在 `kind=="table"` 且有 `template` 时，`rows = apply_template(rows, template)` 后再返回。`template` 为 None 行为不变（向后兼容）。
- [ ] **Step 2: server.py 加 doc-recipes CRUD** — `GET /api/doc-recipes`（list，`require_loopback`）、`POST /api/doc-recipes`（save，`require_loopback`，body 是模板 dict，可带 sample 字节）、`DELETE /api/doc-recipes/{name}`。仿 `api_knowledge_*` 的 `require_loopback` + 错误处理。
- [ ] **Step 3: `/api/pdf/extract` 加 `template`** — 表单加 `template: str = Form("")`；非空则 `load_doc_recipe(template)` 传给 `extract_pdf`；模板不存在返回 400 带「模板不存在」。
- [ ] **Step 4: 门禁** — `cd backend && python -m pytest tests/ -q` → exit 0（全量不回归）。

---

### Task 4: 前端模板管理 + 上传选模板

**Files:**
- Create: `addin/src/taskpane/components/DocRecipeBar.tsx`（或并入现有入口，实现取清晰可维护者）
- Modify: `addin/src/taskpane/components/PdfAttachSection.tsx`（上传时选模板 + 传 `template` 名）
- Modify: 挂载点（`App.tsx` / `ChatInput.tsx`）+ `taskpane.css`

**Interfaces:**
- Produces: 模板列表 + 新建/删除/改名字（简单表单：name + description + fields 文本编辑）；「附加文档」上传时下拉选模板。
- Consumes: `GET/POST/DELETE /api/doc-recipes`、`POST /api/pdf/extract`（带 `template`）。

**现状缺陷：** 无模板入口；上传不选模板。

- [ ] **Step 1: 模板管理 UI** — `DocRecipeBar.tsx`：列出模板（名字 + 字段数 + 更新时间）、新建（弹简单表单填 name/description，fields 先给一个「文本描述」输入框，P0 不做富表单）、删除、改名字。字段字典的编辑用**文本形式**（JSON 或「字段名:类型:来源」逐行），P0 不做可视化字段编辑器。
- [ ] **Step 2: 上传选模板** — `PdfAttachSection.tsx` 加一个模板下拉（`<select>`，选项来自 `GET /api/doc-recipes`），默认「无模板」；选了模板则 `extract` 的 FormData 加 `template: 模板名`。
- [ ] **Step 3: 门禁** — `cd addin && npm run typecheck` → exit 0；`cd addin && npm run build` → exit 0；`npm run test:unit` → 全绿。

---

## 真机验收（管理员 / 桌面 Excel，不代跑）

沙箱验不到，Codex **禁止声称已验证**，只写「待真机验收」。验收者做：

1. 建一个「增值税发票」模板（name/description + fields 文本，含 `金额` 字段 `numberStyle: eu`）。
2. 上传那张欧式数字的发票 PDF，选该模板 → 进工作簿 → 金额列应已归一化为美式数字（`1.234,56` → `1234.56`）。
3. 建一个无模板的对照：不选模板上传同一发票 → 金额列是原始欧式文本（未清洗）。
4. 模板列表/删除/改名字在任务窗格可见且生效；重启后模板仍在（`~/.claude-excel-web/doc-recipes/`）。
5. 样例（图片或 PDF）能上传并存进模板，P0 不解析（上传后不报错、模板里能看到样例名）。

## 收尾

1. `cd backend && python -m pytest tests/ -q` → exit 0。
2. `cd addin && npm run typecheck` → exit 0；`npm run build` → exit 0；`npm run test:unit` → 全绿。
3. 提交（任务分支，一条 commit）：
   `git add backend/doc_recipe.py backend/format_clean.py backend/tests/test_doc_recipe.py backend/tests/test_format_clean.py backend/pdf_extract.py backend/server.py addin/src/taskpane/components/DocRecipeBar.tsx addin/src/taskpane/components/PdfAttachSection.tsx addin/src/taskpane/taskpane.css && git commit -m "feat(doc-recipe): 文档识别模板 P0（文字说明模板+数据字典+格式清洗+手动选模板）"`（挂载点改动一并 add）。
4. 真机验收段留给管理员，Codex 不代跑、不标 done 时声称已验。
5. 全部通过后：按 `docs/coordination.md`，review 交回 Claude 对照本 plan 逐粒核对。

<!-- 进度 log（2026-08-30 Codex）：P0 已实现并合入 master（a9dfa08 + 修复 29edb47），门禁全绿；真机验收待管理员，review 交 Claude。 -->
