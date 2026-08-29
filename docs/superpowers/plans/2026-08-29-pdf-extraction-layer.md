---
status: done
---
# PDF 抽取层（文本 + 表格 + 扫描件 OCR，附加文件入口按内容分流）（2026-08-29）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 新增一套**后端 PDF 抽取层** + 任务窗格「附加文件」入口。用户点「附加 PDF」上传后，后端自动判型（文本型 / 表格型 / 扫描件），按内容分流：**正文 → 落知识库**（对话 `search_knowledge` 引用），**表格 → 结构化表行进簿**（Office JS 写格，不进模型），**扫描件 → OCR**（默认本地，可选云）后再分流。三种都要；**不新增斜杠、不新增模型算子**——这是纯 UI 入口 + 后端 API，模型不参与。

**Architecture:** 复用既有后端知识库与取数的数据流，不新造机制。

- **文本型**：`pypdf` 抽文本 → 复用 [knowledge_store.py](backend/knowledge_store.py) `ingest_document(filename, content)` 落知识库 → 对话 `search_knowledge` 引用 `docName`。
- **表格型**：`pdfplumber` 抽表格 → 复用取数「表行进簿」的 `{sheetName, rows}` 形态（对齐 [web_tools.py](backend/web_tools.py) `fetch_url_content(as_rows=True)` 的返回）→ 前端 Office JS `writeToNewSheet(sheetName, rows)` 写格。
- **扫描件**：无文本层 → OCR。默认本地 `pytesseract`（敏感不上云）；可选云「百炼 doc-parse」（高识别率但内容上云，需前端授权闸门）。OCR 结果再按「出文本 / 出表」分流。
- **判型是纯函数**：`detect_kind(text_len, table_count)` → `text | table | scanned`，可单测，不依赖真实 PDF 字节。
- **配置**：`config.json` 加 `ocrBackend`（`local` | `cloud`），沿用 `config_store.py` `DEFAULT_CONFIG` 机制。

**Context / 已核实事实（不要重测）：**

- 知识库 `ALLOWED_EXT = {".md", ".markdown", ".txt", ".csv"}`（`knowledge_store.py:28`），**不含 `.pdf`**；`ingest_document(filename, content)` 吃**纯文本 content**，不是 PDF 字节。所以 PDF 正文的落库路径是「抽文本 → 以 `.md`/`.txt` 名义 `ingest_document`」，不能直接扩展 `ALLOWED_EXT` 塞 PDF 字节。
- 取数「表行进簿」的返回形态：`fetch_url_content(url, as_rows=True)` → `{"url", "sheetName", "rows": [[...]], "truncated"}`（`web_tools.py:482-490`）。前端写格走 `E.writeToNewSheet(sheetName, rows)`（`skill-handlers.ts` `write_to_sheet` case 已用）。
- 知识库 API：`POST /api/knowledge`（ingest，`server.py:149`）、`POST /api/knowledge/search`、`GET /api/knowledge`（list）。路由在 `ingest_router`，`server.py` 顶部 `from knowledge_store import ...`。
- 配置：`config_store.py` `DEFAULT_CONFIG = {"activeProvider", "providers", "embeddingModel"}`，`get_config()` 返回合并后 dict。加 `ocrBackend` 照抄 `embeddingModel` 的模式（`knowledge_store.embed_texts` 读 `cfg.get("embeddingModel")`）。
- 依赖现状：`backend/requirements.txt` 只有 fastapi/uvicorn/python-multipart/httpx/playwright/pyyaml，**无任何 PDF/OCR 库**。
- 前端 multipart 上传先例：[BackupSection.tsx](addin/src/taskpane/components/BackupSection.tsx)（`form.append('file', file)` + `fetch`）；知识栏入口在 [ChatInput.tsx](addin/src/taskpane/components/ChatInput.tsx)（`title="本机知识库"`）。写格函数 `writeToNewSheet` 由 `addin/src/excel` 导出。
- 安装脚本 [install.bat](install.bat) `[3/4]` 装 Python 依赖 + `playwright install chromium`；**本地 OCR 的 tesseract 二进制要加在这一步**（Windows 上 `winget install -e --id UB-Mannheim.TesseractOCR` 或提示手动，chi_sim 语言包）。
- CLAUDE.md 纪律（边界来源）：取数≠调研≠知识库强制分列；写格唯一通道核心算子/Office JS；模型不进表体；敏感/密码不上云不进模型；行业口径不进核心（本层只做**通用** PDF 抽取，不识别报关单/合同等业务列）。

## Global Constraints

- **不新增核心算子、不新增斜杠**：入口是任务窗格「附加 PDF」UI 按钮 + 后端 `POST /api/pdf/extract`，模型不参与抽取与分流。
- **分列不可破**：正文只进知识库、表格只进簿，两者**不合成一步**；扫描件 OCR 后仍按「出文本/出表」二选一分流，不"既入库又进簿"。
- **写格只走 Office JS**：表格型由前端 `writeToNewSheet` 一次写格，`rows` 不进模型上下文。
- **本机优先、云需授权**：文本/表格/本地 OCR 全在本机；云 OCR（百炼 doc-parse）必须前端弹「内容将上传云端、确认不含敏感信息」闸门，默认关。
- **纯逻辑可单测**：`detect_kind`、`extract_pdf` 的判型/分流逻辑无副作用，可用内存 PDF 字节单测。
- **敏感内容**：OCR/抽取全在本机完成，抽出的文本只经现有「本机向量索引 + 检索片段引用」进对话，不整篇发第三方 LLM。

---

### Task 1: 后端 `pdf_extract.py` 抽取层（文本 + 表格 + 本地 OCR）+ 依赖 + 单测

**Files:**
- Create: `backend/pdf_extract.py`
- Modify: `backend/requirements.txt`（加 `pypdf`、`pdfplumber`、`pillow`；`pytesseract` 标可选/注释——tesseract 二进制走 install.bat）
- Create: `backend/tests/test_pdf_extract.py`

**Interfaces:**
- Produces: 一个纯函数 `detect_kind(text_len, table_count)` + 一个 `extract_pdf(data: bytes, ocr_backend="local")` 统一出口，返回：
  ```python
  {
    "kind": "text" | "table" | "scanned",
    "text": str | None,            # kind=text 或 scanned-OCR 出文本
    "rows": list[list[str]] | None,  # kind=table 或 scanned-OCR 出表
    "tables": int, "pages": int,
    "ocrBackend": "local" | "cloud" | None,
    "sheetName": str, "preview": str,
  }
  ```
- Consumes: `pypdf` / `pdfplumber` / `pillow`+`pytesseract`（本地 OCR，可选导入，无 tesseract 时 `extract_pdf` 对 scanned 类返回明确 error 而非崩溃）。

**现状缺陷：** 无；后端完全没有 PDF 能力。

- [x] **Step 1: 依赖** — `requirements.txt` 加 `pypdf>=5`、`pdfplumber>=0.11`、`pillow>=10`；`pytesseract` 加注释说明「本地 OCR 可选，需 tesseract 二进制（install.bat 装）」。`pip install -r backend/requirements.txt` 后 `python -c "import pypdf, pdfplumber, PIL; print('ok')"` → 输出 `ok`、exit 0。
- [x] **Step 2: `detect_kind(text_len, table_count)` 纯函数** — 判定规则：`text_len >= 阈值(如 40)` → `text`；否则 `table_count > 0` → `table`；否则 → `scanned`。阈值写成模块常量，可测。
- [x] **Step 3: `extract_pdf_text(data)`** — `pypdf.PdfReader` 逐页 `extract_text()`，合并、去空页；返回文本字符串。
- [x] **Step 4: `extract_pdf_tables(data)`** — `pdfplumber` 逐页 `extract_tables()`，取**最大**表格（行×列最大），转 `list[list[str]]`（空单元格补 `""`）；返回 `rows` 或 `None`。表头判空对齐 `fetch_recipe.drop_repeated_header` 精神（若首行与第二行相同则去重首行）。
- [x] **Step 5: `extract_pdf_ocr_local(data)`** — 逐页转图片（`pypdf`/`pdfplumber` 渲染 + `PIL`）→ `pytesseract.image_to_string(..., lang="chi_sim+eng")`。tesseract 缺失时抛**可读** error（「未安装 tesseract，本地 OCR 不可用；见 install.bat」），不静默返回空。
- [x] **Step 6: `extract_pdf(data, ocr_backend)` 统一出口** — 先 `pypdf` 抽文本 + `pdfplumber` 抽表；`detect_kind` 判型：`text` → 返回 text；`table` → 返回 rows + `sheetName = "PDF_" + 文件名去后缀（≤28 字）`；`scanned` → 按 `ocr_backend` 走本地/云 OCR，OCR 结果含表格特征则当 table 返回 rows，否则当 text 返回。`preview` 取前 ~200 字。`ocrBackend=None` 且 scanned 时返回 `{kind:"scanned", error:"需 OCR（本地未装 tesseract 或需云授权）"}`。
- [x] **Step 7: 单测 `test_pdf_extract.py`** — (a) `detect_kind` 边界（长文本→text、无文本有表→table、都空→scanned）；(b) 用 `pypdf` 在内存生成一个带文本的最小 PDF，断言 `extract_pdf` 返回 `kind=text` 且 text 非空；(c) 无 tesseract 环境时 scanned 分支返回可读 error（不崩）。`cd backend && python -m pytest tests/test_pdf_extract.py` → exit 0，`N passed`。
- [x] **Step 8: 门禁** — `cd backend && python -m pytest tests/test_pdf_extract.py -q` → exit 0；`python -c "import pdf_extract"` → exit 0。

---

### Task 2: API 端点 `POST /api/pdf/extract` + 配置 `ocrBackend` + 知识库 ingest 接入

**Files:**
- Modify: `backend/server.py`（加端点 + import）
- Modify: `backend/config_store.py`（`DEFAULT_CONFIG` 加 `ocrBackend: "local"`）

**Interfaces:**
- Produces: `POST /api/pdf/extract`（multipart `file` + 可选 form 字段 `ocrBackend`）→ `extract_pdf(...)` 的 JSON；`POST /api/knowledge` 已有（前端复用，不改）。
- Consumes: `pdf_extract.extract_pdf`、`get_config`。

**现状缺陷：** 无 PDF 入口；`ocrBackend` 无配置位。

- [x] **Step 1: `config_store.py`** — `DEFAULT_CONFIG` 加 `"ocrBackend": "local"`；确认 `get_config()` 对缺字段的旧 `config.json` 仍能合并出默认值（不因缺 `ocrBackend` 报错）。
- [x] **Step 2: `server.py` 端点** — `@app.post("/api/pdf/extract")`，`async def api_pdf_extract(request, file: UploadFile = File(...), ocr_backend: str = Form(""))`：读 `file.file.read()` 字节 → `extract_pdf(data, ocr_backend or cfg["ocrBackend"])` → 返回 JSON；`ocr_backend == "cloud"` 且非显式授权时返回 `{"error": "云 OCR 需前端确认授权"}`（授权闸门由前端传一个确认标记，见 Task 4）。
- [x] **Step 3: 知识库接入说明**（不改代码，写入 SKILL/文档）——正文类由**前端**把 `extract_pdf` 返回的 `text` 以 `原名.md` 名义调现有 `POST /api/knowledge` ingest，后端**不**在 extract 端点内自动 ingest（职责分离：extract 只抽取，落地由前端决定）。
- [x] **Step 4: 门禁** — `cd backend && python -m pytest tests/ -q` → exit 0（全量不回归）；`python -c "import server"` 语法 OK（若有导入副作用则改用 `python -m py_compile server.py`）。

---

### Task 3: 前端「附加 PDF」入口 + 按 kind 分流

**Files:**
- Create: `addin/src/taskpane/components/PdfAttachSection.tsx`（或并入现有入口，实现取清晰可维护者）
- Modify: 挂载点（`App.tsx` / 知识栏入口 `ChatInput.tsx`）——加一个「附加 PDF」按钮
- Modify: `addin/src/taskpane/taskpane.css`（按钮样式，复用 `.skill-file-input` 一类）

**Interfaces:**
- Produces: 任务窗格一个「附加 PDF」按钮 + 上传 → 分流 → 结果提示 + 触发知识栏/表刷新。
- Consumes: `POST /api/pdf/extract`、`POST /api/knowledge`、`addin/src/excel` 的 `writeToNewSheet`。

**现状缺陷：** 无 PDF 入口；知识栏只认 `.md/.txt/.csv` 文本文件。

- [x] **Step 1: 上传** — 复用 `BackupSection.tsx` 的 multipart 模式：`form.append('file', file)` → `fetch('/api/pdf/extract', {method:'POST', body:form})`。文件选择器 `accept=".pdf"`。
- [x] **Step 2: 分流（前端）** — 拿 `{kind, text, rows, sheetName, preview, error}`：
  - `kind === "text"`（或 scanned-OCR 出 text）→ `POST /api/knowledge`，body `{name: 原名+".md", content: text}`（按现有 ingest API 的字段名，实现时对齐 `api_knowledge_ingest` 的 req 结构）→ 提示「已入知识库，可对话提问」+ 刷新知栏。
  - `kind === "table"`（或 scanned-OCR 出 rows）→ `writeToNewSheet(sheetName, rows)` → 提示「表已进簿：<sheetName>（N 行）」。
  - `error` → 直接展示，不静默。
- [x] **Step 3: 按钮 + 样式** — 「附加 PDF」按钮放在知识栏/取数栏入口旁；上传中显示 loading，完成后提示结果。**不新增斜杠**。
- [x] **Step 4: 门禁** — `cd addin && npm run typecheck` → exit 0；`cd addin && npm run build` → exit 0。

---

### Task 4: 云 OCR（百炼 doc-parse）+ 授权闸门

**Files:**
- Modify: `backend/pdf_extract.py`（`extract_pdf_ocr_cloud`）
- Modify: `addin/src/taskpane/components/PdfAttachSection.tsx`（授权确认）

**Interfaces:**
- Produces: `extract_pdf_ocr_cloud(data)` 调百炼文档解析（复用 `bailian`/百炼凭证，实现时对齐项目已有的 bailian 接入方式或 `qwen` provider 的 dashscope baseUrl），返回文本。
- Consumes: 百炼 doc-parse API；前端授权确认。

**现状缺陷：** 无云 OCR；无授权闸门。

- [x] **Step 1: `extract_pdf_ocr_cloud(data)`** — 调百炼文档解析接口（doc-parse），返回识别文本；失败返回可读 error（不静默空）。**敏感内容风险**：此路径内容上云，仅在前端授权后调用。
- [x] **Step 2: 前端授权闸门** — 当 `ocrBackend === "cloud"` 时，上传前弹确认「该 PDF 内容将上传云端解析，请确认不含敏感信息（账号/密码/合同隐私）」，用户确认后才带 `ocrBackend=cloud` + 确认标记调 extract。默认 local。
- [x] **Step 3: 门禁** — `cd backend && python -m pytest tests/ -q` → exit 0；`cd addin && npm run typecheck` → exit 0；`cd addin && npm run build` → exit 0。

---

## 真机验收（管理员 / 桌面 Excel，不代跑）

沙箱验不到，Codex **禁止声称已验证**，只写「待真机验收」。验收者在装了依赖的本机做：

1. **tesseract 安装**：`install.bat` 后 `where tesseract` 能查到；`tesseract --list-langs` 含 `chi_sim`。若无，装 `UB-Mannheim.TesseractOCR` + chi_sim 语言包。
2. **文本型 PDF**：附加一个文本 PDF → 入库知识库 → 对话 `/知识` 能检索到 `docName` 并引用片段。
3. **表格型 PDF**：附加一个报表 PDF → 表格进簿（新 sheet）→ 数字/列对齐原 PDF，无乱序。
4. **扫描件 PDF**：附加一个扫描件（图片）→ 本地 OCR 出文本 → 入库/进簿；识别率实测（乱码比例）记录。
5. **云 OCR 闸门**：切 `ocrBackend=cloud` 后，上传前**必须**弹授权确认；取消则不走云。
6. **撤销**：进簿的表可用任务窗格 ↩ 回退。
7. **敏感不泄露**：本地路径全程不发外部；只有云 OCR 授权后才上云。

## 收尾

1. `cd backend && python -m pytest tests/ -q` → exit 0。
2. `cd addin && npm run typecheck` → exit 0；`cd addin && npm run build` → exit 0。
3. 提交（任务分支，一条 commit）：
   `git add backend/pdf_extract.py backend/tests/test_pdf_extract.py backend/requirements.txt backend/server.py backend/config_store.py addin/src/taskpane/components/PdfAttachSection.tsx addin/src/taskpane/taskpane.css && git commit -m "feat(pdf): PDF 抽取层（文本/表格/本地OCR，附加文件入口按内容分流；云OCR授权闸门）"`（挂载点改动若在 App.tsx/ChatInput.tsx 一并 add）。
4. 真机验收段留给管理员，Codex 不代跑、不标 done 时声称已验。
5. 全部通过后：按 `docs/coordination.md`，review 交回 Claude 对照本 plan 逐粒核对。

## Progress log

- 2026-08-29: 已实现 PDF 抽取层、`/api/pdf/extract`、附加 PDF 分流入口、本地 OCR 与百炼 doc-parse 云路径；云路径保留前端显式授权闸门。后端 204 passed，前端 300 passed，typecheck/build 通过；`build_dashboard` 缺失的后端 executor 注册已在门禁中补齐。真机验收（文本入库、表格进簿、扫描件识别率、云闸门、撤销与敏感信息路径）待管理员执行。
