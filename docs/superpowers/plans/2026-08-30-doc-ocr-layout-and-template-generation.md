---
status: done
---
# 文档 OCR 从「可用」到「真正好用」：布局感知 + 上传图片 AI 生成模板 + 两 Sheet 还原（2026-08-30）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在 doc-recipe P0（手动建模板 + 表格位置对齐 + 单表进簿）之上，把文档识别升级成**真正好用**：用户**上传一张图片 → 后端识别（预处理 + 布局感知）→ 自动生成模板候选 → 用户只确认/修正 → 保存**；之后选该模板，提取结果**还原成「抬头 + 明细」两个 Sheet**。定位**本地为主、云可选**（隐私优先、零成本兜底；云 doc-parse 作「难文档增强」）。

**现状核心缺陷（本 plan 要解决的根因）：**

1. **布局被 flatten 丢弃**：云 `doc_parse` 返回带表格的结构化结果，但 `_doc_parse_text`/`_longest_text` 只取最长文本串；本地 `_rows_from_ocr_text` 只认 `|`/tab/多空格行，抬头键值（发票号/日期/价税合计）被 `else: continue` 跳过，markdown 表头分隔行 `|---|---|` 被当成数据行。
2. **列对齐靠位置**：`apply_template` 用 `row[index]` 位置对齐，`source` 是死字段；列顺序一变就错位。
3. **本地识别差**：`extract_image_ocr_local` 直接 `image_to_string`，无二值化/deskew/放大（backlog 已知项）。
4. **输出只有一张明细表**：抬头键值、合计丢失，无法「忠实还原」。
5. **清洗算子薄**：`clean_number` 只做 us/eu 千分位；无大写金额（壹佰贰拾叁→123）、无全角/半角归一、无 OCR 纠错。

**Architecture:** 引入一个**布局文档中间模型 `LayoutDocument`**，把「识别结果」从 `list[list[str]]` 升级为 `kvs[] + tables[]`。提取管线和模板应用都围绕它：

```
上传图片/PDF
  → 预处理（二值化/deskew/放大，本地）
  → 布局提取（本地 tesseract 词盒聚类 / 云 doc-parse 结构化，二者产出同一 LayoutDocument）
  → 无模板：propose_recipe(layout) 推断字段 → 返回 proposedRecipe 给前端，用户确认/修正
  → 有模板：apply_recipe(layout, template) → {sheets:[抬头, 明细]} → 前端 writeToNewSheet 写两 Sheet
```

- **布局文档模型**：新模块 `layout_doc.py`（纯数据类 + to_dict/from_dict）。
- **预处理**：新模块 `image_preprocess.py`。
- **布局提取**：新模块 `layout_extract.py`（本地词盒聚类 + 云 doc-parse 结构化消费，产出 `LayoutDocument`）。
- **模板提议**：新模块 `recipe_propose.py`（列内容 → 类型推断 + `propose_recipe`，通用算子，不硬编码业务字段）。
- **清洗**：扩展 `format_clean.py`（`clean_chinese_amount`/`normalize_ocr_text`/多格式日期 + `apply_recipe`）。
- **模板存储**：扩展 `doc_recipe.py`（字段加 `group`；`source` 从自由文本升级为定位符）。

**Context / 已核实事实（不要重测）：**

- `pdf_extract.py`：`extract_pdf(data, ocr_backend, filename, template=None)`；本地 `extract_image_ocr_local`（`pytesseract.image_to_string`，无预处理）、`extract_pdf_ocr_local`（pdfium 渲染 200 DPI）、`extract_pdf_ocr_cloud`（Bailian `doc-parse`，`enable_table: True`，`_doc_parse_text`/`_longest_text` 只取最长文本）；`_rows_from_ocr_text`（`|`/tab/`\s{2,}` 分行，纯文本键值被跳过）；`extract_pdf_tables`（pdfplumber + `_with_inferred_header`/`_looks_like_header`/`_is_numeric`）；`_result()` 返回 `{kind,text,rows,tables,pages,ocrBackend,sheetName,preview,error}`。
- `format_clean.py`：`clean_number`/`clean_date`（已返回 ISO 日期字符串）/`is_null`/`apply_template(rows, template, *, has_header=True)`。
- `doc_recipe.py`：`validate_doc_recipe`/`save_doc_recipe`/`load_doc_recipe`/`list_doc_recipes`/`delete_doc_recipe`；`FIELD_TYPES=("text","number","date","amount","percent")`；`_normalize_fields` 保留 `source`（≤100 字）；`format` 白名单 `numberStyle/stripSymbols/nullValues/dateFormat`。
- `server.py`：`POST /api/pdf/extract`（multipart `file`+`ocr_backend`+`cloudConfirmed`+`template`）；`GET/POST/DELETE /api/doc-recipes`。
- 前端 `PdfAttachSection.tsx`：`resultRows()` 保留 number；`landSheet()` 调 `writeToNewSheet(p.sheetName, rows)` 写**单** Sheet；`PdfResult` 有 `rows`/`text`/`sheetName`/`ocrBackend`/`error`。`DocRecipeBar.tsx`：`fieldsToText`/`parseFieldsText`（行格式 `字段名:类型:来源` 或 JSON 数组），`openCreate/openEdit/save/remove`。
- 挂载：`ChatInput.tsx` 同时挂 `DocRecipeBar`（`onChanged`→`docRecipeVersion++`）和 `PdfAttachSection`（`refreshKey={docRecipeVersion}`），二者是兄弟组件、无共享 state。`writeToNewSheet(sheetName, values: (string|number)[][])` 在 `addin/src/excel/write.ts`。
- 配置：`ocrBackend`（local/cloud）、`dashscopeBaseUrl`（`_dashscope_base`）、`DASHSCOPE_API_KEY`（`providers.qwen.apiKey`）。
- CLAUDE.md 纪律：写格唯一通道 Office JS（后端不写格）；算子通用、参数化，**禁止**硬编码发票业务字段进核心；字段名是用户侧数据；模型上下文不进表体。

## Global Constraints

- **字段名/业务口径只进用户侧**：`propose_recipe` 读的是文档自带的表头/键名，**禁止**在核心代码里写死「发票号/金额/税率」等字段名或默认 schema。
- **算子通用**：类型推断（`text/number/amount/percent/date`）基于内容特征；`clean_chinese_amount` 解析中文大写数字（通用，非发票专属）。
- **写格只走 Office JS**：后端产出 `sheets` 数据，前端 `writeToNewSheet` 写格；后端不写格、不用 openpyxl。
- **本地优先**：默认 `ocrBackend=local` 也要能跑通「生成模板 + 两 Sheet」；云路径是可选增强，不阻塞本地。
- **向后兼容**：无模板时行为不变（仍返回 `rows`）；旧模板（无 `group`、`source` 是自由文本）仍按位置对齐进单表。
- **布局提取是 best-effort v1**：本地词盒聚类对不规则单据不保证 100% 准；准确度以真机验收为准，Codex 不代跑、不标 done 时声称已验。

---

### Task 1: 图片预处理 `image_preprocess.py`

**Files:**
- Create: `backend/image_preprocess.py`
- Create: `backend/tests/test_image_preprocess.py`

**Interfaces:**
- Produces: `preprocess_image(data: bytes) -> PIL.Image.Image`（灰度 → 二值化 → deskew → 放大）。
- Consumes: `Pillow`（`Image`/`ImageOps`/`ImageFilter`），不引入 opencv 硬依赖（若 Pillow 够用则纯 Pillow，减少安装负担）。

**现状缺陷：** `extract_image_ocr_local` 直接 `image_to_string`，倾斜/低对比/小字识别差。

- [x] **Step 1: 灰度 + 自适应二值化** — 转 `L`，对**照片**（非扫描）用局部自适应阈值（如 Pillow 分块阈值或 `ImageOps.autocontrast` + 全局阈值），保留文字笔画；扫描件跳过二值化避免颗粒感。暴露参数 `mode`（`auto|photo|scan`）默认 `auto`。
- [x] **Step 2: deskew（纠偏）** — 用投影法估计倾斜角（对二值图沿角度投影求方差最大，角度扫 `-5°~5°` 步长 `0.5°`），`Image.rotate(angle, resample=Image.BICUBIC, expand=True)` 纠正。无文本（纯空白）时直接返回原图。
- [x] **Step 3: 放大** — 若短边 < 1600px，按比例放大到短边 ~2000px（`Image.LANCZOS`），提升 tesseract 对小字识别率。
- [x] **Step 4: 单测 `test_image_preprocess.py`** — (a) 生成一张倾斜 3°、带文本的合成图 → 处理后文字基线角度 |残留角| < 1°；(b) 低对比合成图 → 处理后二值对比度提升；(c) 小图 → 输出短边 ≥ 1600；(d) 空图/纯白图不抛异常、返回同尺寸图。`cd backend && python -m pytest tests/test_image_preprocess.py -q` → exit 0。

---

### Task 2: 布局文档模型 `layout_doc.py`

**Files:**
- Create: `backend/layout_doc.py`
- Create: `backend/tests/test_layout_doc.py`

**Interfaces:**
- Produces: `KVItem(label, value)`、`TableBlock(name, headers, rows)`、`LayoutDocument(kvs, tables, raw_text)` + `to_dict()`/`from_dict()`。
- Consumes: 无（纯数据模型，被 layout_extract / recipe_propose / apply_recipe 消费）。

**现状缺陷：** 无；提取结果是扁平 `list[list[str]]`，无键值/多表概念。

- [x] **Step 1: dataclasses** — 定义 `KVItem`/`TableBlock`/`LayoutDocument`（`field(default_factory=...)`）；`LayoutDocument` 提供 `to_dict()`（可 JSON 序列化，含 `kvs`/`tables`/`raw_text`）与 `from_dict()`。
- [x] **Step 2: 便捷方法** — `LayoutDocument.first_table() -> TableBlock | None`；`TableBlock.column(name) -> int | None`（表头归一化匹配，见 Task 6 匹配规则）；`LayoutDocument.kv(label) -> str | None`。
- [x] **Step 3: 单测** — to_dict/from_dict 往返一致；空表/无表 `first_table()` 返回 None；`column` 对全角/半角空格做归一化匹配。`pytest tests/test_layout_doc.py -q` → exit 0。

---

### Task 3: 布局提取 `layout_extract.py`

**Files:**
- Create: `backend/layout_extract.py`
- Create: `backend/tests/test_layout_extract.py`

**Interfaces:**
- Produces: `extract_layout_from_image(preprocessed: PIL.Image) -> LayoutDocument`；`extract_layout_from_pdf(data: bytes) -> LayoutDocument`；`doc_parse_to_layout(payload) -> LayoutDocument`（云结构化消费）。
- Consumes: `pytesseract.image_to_data`（词盒）、`layout_doc`、现有 `pdf_extract.extract_pdf_tables`/`extract_pdf_text`、`_doc_parse_text` 的上游结构化 payload。

**现状缺陷：** 本地 `_rows_from_ocr_text` 只按 `|`/tab/空格分行，丢键值、丢多表、把表头分隔行当数据；云 `_longest_text` flatten 掉布局。

- [x] **Step 1: 词盒聚类（本地图片）** — `pytesseract.image_to_data(..., output_type=Output.DICT)` 取 word 级 `left/top/width/height/conf/text`；丢弃低置信词；按垂直重叠把词聚成**行**，按行间垂直空隙聚成**块**。
- [x] **Step 2: 行内分列 + 键值识别** — 行内词按水平空隙分列（大空隙=列分隔）。一行只有 2 列且左列短（≤12 字）→ `KVItem(label, value)`；连续多行且列位置一致 → 候选表行。
- [x] **Step 3: 表头判定** — 复用 `pdf_extract._looks_like_header` 语义（全文本行=表头）；表头行归 `TableBlock.headers`，其余归 `rows`。多张表（垂直空隙大）→ 多个 `TableBlock`。
- [x] **Step 4: PDF 布局** — `extract_layout_from_pdf`：文本型 PDF 用 `extract_pdf_tables` 的 `rows` 包成单个 `TableBlock`（`_with_inferred_header` 已给表头）；从 `extract_pdf_text` 里用 `label[:：]\s*value` 抽键值对（≤ 3 个词的短标签行）。扫描型 PDF 走 `extract_pdf_ocr_local` 出文本后复用词盒路径（或先渲染成图走 Step 1-3）。
- [x] **Step 5: 云结构化消费（可选，不阻塞本地）** — `doc_parse_to_layout`：从 doc-parse 返回的 markdown/JSON 里解析表格块（markdown `|` 表 → `TableBlock`，跳过 `|---|` 分隔行）与键值；**不再** `_longest_text` flatten。无 API key 时本地照常跑。
- [x] **Step 6: 单测 `test_layout_extract.py`** — (a) 合成词盒（手工构造 left/top/width/height/conf/text）→ 正确聚出 1 表 + N 个 kv；(b) markdown 表带 `|---|` → 分隔行被跳过、表头归 headers；(c) 键值行 `发票号码: 12345678` → `kv("发票号码")=="12345678"`；(d) 无表无键值的纯文本 → 返回空 LayoutDocument（不抛异常）。`pytest tests/test_layout_extract.py -q` → exit 0。

---

### Task 4: 类型推断 + 模板提议 `recipe_propose.py`

**Files:**
- Create: `backend/recipe_propose.py`
- Create: `backend/tests/test_recipe_propose.py`

**Interfaces:**
- Produces: `infer_type(values: list[str]) -> str`；`propose_recipe(layout: LayoutDocument, *, base_name: str = "") -> dict`（返回 `{name, description, fields:[{name,type,source,group}]}`）。
- Consumes: `layout_doc`、`format_clean.clean_number`/`clean_date`（用于推断，只读）。

**现状缺陷：** 无；模板靠用户手写字段/类型。

- [x] **Step 1: `infer_type(values)`** — 取非空样本（≥3 个，不足则取全部），规则（**通用，不写死业务名**）：
  1. 全部含 `%` 且去 `%` 后可 `float` → `percent`；
  2. 含货币符号（`$€£¥￥`）且剥符号后可 `float` → `amount`；
  3. 可 `clean_number(value,"us")` 或 `clean_number(value,"eu")` → `number`；
  4. 能按常见日期格式（`%Y-%m-%d`/`%Y/%m/%d`/`%m/%d/%Y`/`%Y.%m.%d`）解析 → `date`；
  5. 否则 → `text`。
- [x] **Step 2: `propose_recipe(layout, base_name)`** — 明细：取 `layout.first_table()`，每个表头列生成 `{name: 表头文本, type: infer_type(该列), source: 表头文本, group: "detail"}`（无表头列用 `col[i]` 占位名）；抬头：每个 `KVItem` 生成 `{name: label, type: infer_type([value]), source: label, group: "header"}`。`name` 用 `base_name`（或 `layout.raw_text` 前 20 字），`description` 固定「自动生成，请确认字段名与类型」。
- [x] **Step 3: 单测 `test_recipe_propose.py`** — (a) 表 `[["品名","金额","税率"],["A","1,234.56","13%"]]` → 推断 `text/number/percent`，字段 `source`=表头、`group`=detail；(b) kv `发票号码: 12345678` → 生成 header 字段 `source=发票号码`；(c) 空 layout → `fields` 至少含明细列或返回空（不崩）。`pytest tests/test_recipe_propose.py -q` → exit 0。

---

### Task 5: 模板 schema 扩展（`group` + `source` 定位符）

**Files:**
- Modify: `backend/doc_recipe.py`
- Modify: `backend/tests/test_doc_recipe.py`

**Interfaces:**
- Produces: `_normalize_fields` 接受 `group`（`header|detail`，默认 `detail`）；`source` 语义升级为「定位符」（header 字段=键名，detail 字段=表头列名，空=位置回退）。
- Consumes: 无。

**现状缺陷：** 字段无 `group`，`source` 是自由文本不参与匹配。

- [x] **Step 1: `group` 白名单** — `_normalize_fields` 读 `field.get("group")`，∈`{"header","detail"}` 则保留，否则丢弃（默认 `detail`）；向后兼容旧模板（无 `group` → `detail`）。
- [x] **Step 2: `source` 归一化** — 保留现有 `source`（≤100 字），文档注明新语义：`group=header` 时 `source`=键名（如 `发票号码`）；`group=detail` 时 `source`=表头列名（如 `金额`）；`source` 空 → 位置对齐回退。**不改** `source` 的存储结构（仍是字符串），匹配逻辑在 Task 6 的 `apply_recipe` 里做归一化。
- [x] **Step 3: 单测** — 旧字段（无 `group`）→ `group=="detail"`；`group:"header"` 保留；`group:"bogus"` 丢弃回 `detail`；`source` 空保留空。`pytest tests/test_doc_recipe.py -q` → exit 0。

---

### Task 6: 布局感知清洗 + 两 Sheet 输出 `apply_recipe`

**Files:**
- Modify: `backend/format_clean.py`
- Modify: `backend/tests/test_format_clean.py`

**Interfaces:**
- Produces: `normalize_key(s: str) -> str`；`apply_recipe(layout: LayoutDocument, template: dict) -> list[dict]`（返回 `[{name, rows}]`，至少含「抬头」「明细」两 Sheet）。
- Consumes: `layout_doc`、`clean_number`/`clean_date`/`is_null`。

**现状缺陷：** `apply_template` 只做位置对齐、单表输出。

- [x] **Step 1: `normalize_key(s)`** — 归一化匹配键/表头：去空白、全角→半角、统一大小写；供 `column()`/`kv()` 与 `source` 匹配用。
- [x] **Step 2: 明细 Sheet** — 取 `template.fields` 中 `group=="detail"` 的字段；对每个字段用 `normalize_key(source)` 在 `first_table().headers` 里找列（`source` 空则按字段顺序位置回退）；表头行 = 字段 `name`；每列按 `field.type`+`field.format` 调 `clean_number`/`clean_date`。返回 `{name: 模板名+"-明细", rows: [[表头...],[数据...]]}`。
- [x] **Step 3: 抬头 Sheet** — 取 `group=="header"` 的字段；每个字段 `layout.kv(normalize_key(source))` 取值，按 `field.type` 清洗；`rows` 形如 `[[字段name1, 值1],[字段name2, 值2],...]`（两列：字段名/值）。返回 `{name: 模板名+"-抬头", rows}`。无 header 字段则抬头 Sheet 仍返回（只有表头「字段/值」空表或省略——实现取空 Sheet，不报错）。
- [x] **Step 4: 向后兼容** — 无 `group` 的旧模板：全部字段按 `detail` 处理，等价于旧 `apply_template` 位置对齐，输出单「明细」Sheet；`apply_template` 保留不删（旧路径用）。
- [x] **Step 5: 单测** — (a) 表 `[["品名","金额"],["A","1,234.56"]]` + 字段 `品名(text)/金额(amount,us)` + `group=detail` → 明细 Sheet 金额 `1234.56`；(b) kv `发票号码: 12345678` + header 字段 → 抬头 Sheet 含 `["发票号码","12345678"]`；(c) 列顺序打乱（模板字段顺序与表头顺序不同）仍按 `source` 正确对齐；(d) 旧模板（无 group）→ 单明细 Sheet 位置对齐。`pytest tests/test_format_clean.py -q` → exit 0。

---

### Task 7: 接入提取管线 + server（`sheets` + `proposedRecipe`）

**Files:**
- Modify: `backend/pdf_extract.py`
- Modify: `backend/server.py`
- Modify: `backend/tests/test_doc_recipe_api.py`

**Interfaces:**
- Produces: `extract_pdf(..., template=None)` 返回结果加 `sheets`（有模板时）与 `proposedRecipe`（无模板且可推断时）；`/api/pdf/extract` 透传这两个字段。
- Consumes: `layout_extract`、`recipe_propose`、`format_clean.apply_recipe`、`doc_recipe.load_doc_recipe`。

**现状缺陷：** `extract_pdf` 只返回扁平 `rows`，无布局、无提议。

- [x] **Step 1: `extract_pdf` 产出 LayoutDocument** — 在现有提取分支后，把「表格/OCR 结果」构造成 `LayoutDocument`（本地走 `layout_extract`，云走 `doc_parse_to_layout`）；无模板时 `layout.raw_text` 与 `rows` 保留向后兼容。
- [x] **Step 2: 有模板 → `sheets`** — `template` 非空且含 `group` 字段时，`apply_recipe(layout, template)` → `sheets`，与现有 `rows` 一并返回；`kind` 仍为 `table`。
- [x] **Step 3: 无模板 → `proposedRecipe`** — `template` 为空且 `layout` 有可推断内容时，`propose_recipe(layout, base_name=sheetName)` → `proposedRecipe`（字典，可 JSON 序列化）。`proposedRecipe` 为 None 时不影响现有返回。
- [x] **Step 4: server 透传** — `api_pdf_extract` 无需新端点（`extract_pdf` 返回值直接作为响应 JSON）；确认 `proposedRecipe`/`sheets` 能通过 FastAPI 正常序列化（`sheets` 里 number 是 float，OK）。
- [x] **Step 5: 单测 `test_doc_recipe_api.py`** — 新增：(a) 带模板提取 → 响应含 `sheets`（两张）；(b) 无模板提取（mock `propose_recipe`）→ 响应含 `proposedRecipe`；(c) 旧模板（无 group）→ 仍走 `rows` 单表不崩。`pytest tests/ -q` → exit 0（全量不回归）。

---

### Task 8: 前端两 Sheet 写入 + 「生成模板」入口

**Files:**
- Modify: `addin/src/taskpane/components/PdfAttachSection.tsx`
- Modify: `addin/src/taskpane/components/DocRecipeBar.tsx`
- Modify: `addin/src/taskpane/components/ChatInput.tsx`

**Interfaces:**
- Produces: `PdfResult` 加 `sheets?`/`proposedRecipe?`；`landSheet` 写多 Sheet；`PdfAttachSection` 加 `onProposeRecipe` prop；`DocRecipeBar` 加 `draft` prop 预填表单；`ChatInput` 共享 `docRecipeDraft` state。
- Consumes: `writeToNewSheet`、`GET/POST /api/doc-recipes`。

**现状缺陷：** `landSheet` 只写一张；无「识别结果生成模板」入口；两组件无共享 state。

- [x] **Step 1: `PdfResult` 扩展** — `sheets?: {name: string; rows: (string|number)[][]}[]`；`proposedRecipe?: {name: string; description: string; fields: DocRecipeField[]}`。
- [x] **Step 2: 两 Sheet 写入** — `landSheet`：若 `p.sheets` 非空，遍历 `writeToNewSheet(sheet.name, sheet.rows)` 写多张（`=` 转义守卫沿用）；否则走现有单表逻辑。`PendingLand` 增 `sheets`/`proposedRecipe` 字段并透传。
- [x] **Step 3: 「生成模板」入口** — `pendingResult.proposedRecipe` 非空时，确认面板加一个按钮「据此生成模板」→ 调 `onProposeRecipe(proposedRecipe)`。
- [x] **Step 4: DocRecipeBar 预填** — 加 prop `draft?: DocRecipeField[] & {name?}`（或 `initialRecipe`）；`draft` 变化时 `openCreate` 并预填 `name`/`description`/`fieldsText`（用 `fieldsToText` 生成）。用户仍可改名/改字段/改类型后再「保存」。
- [x] **Step 5: ChatInput 共享 state** — 新增 `const [docRecipeDraft, setDocRecipeDraft] = useState<...>(null)`；`PdfAttachSection` 传 `onProposeRecipe={(r) => { setDocRecipeDraft(r); setShowDocRecipe(true); setShowPdf(false); }}`；`DocRecipeBar` 传 `draft={docRecipeDraft}`；保存后清空 `docRecipeDraft`。
- [x] **Step 6: 门禁** — `cd addin && npm run typecheck` → exit 0；`npm run test:unit` → 全绿；`npm run build` → exit 0。

---

### Task 9: 清洗算子增强（大写金额 / 全角归一 / 多格式日期）

**Files:**
- Modify: `backend/format_clean.py`
- Modify: `backend/tests/test_format_clean.py`

**Interfaces:**
- Produces: `normalize_ocr_text(s: str) -> str`；`clean_chinese_amount(s: str) -> float | None`；`clean_date` 支持多格式尝试。
- Consumes: 无。

**现状缺陷：** 无大写金额、无全角/半角归一、日期只认单一 `dateFormat`。

- [x] **Step 1: `normalize_ocr_text(s)`** — 全角数字/符号 → 半角；去掉数字串内部误插的空格（`1 234.56`→`1234.56`）；**不做**激进的 0/O、1/l 替换（易误伤，留给用户模板 `format` 显式开）。在 `clean_number` 入口调用（无条件、安全）。
- [x] **Step 2: `clean_chinese_amount(s)`** — 解析中文大写金额：`壹贰叁肆伍陆柒捌玖`、`拾佰仟万亿`、`元角分整`，支持 `壹佰贰拾叁元肆角伍分`→`123.45`、`￥`/`人民币`前缀、纯数字含 `元`（`123.45元`→`123.45`）。失败返回 None。**通用解析器，不写死业务字段名**。
- [x] **Step 3: 多格式日期** — `clean_date` 的 `date_format` 支持 `;` 分隔的多格式（`%Y/%m/%d;%Y-%m-%d`），从左到右尝试，命中即返回 ISO 字符串。
- [x] **Step 4: 单测** — `normalize_ocr_text("１ ２３４.５６")` → `"1234.56"`；`clean_chinese_amount("壹佰贰拾叁元肆角伍分")==123.45`、`clean_chinese_amount("123.45元")==123.45`；`clean_date("2018/9/4","%Y/%m/%d;%Y-%m-%d")=="2018-09-04"`；`clean_number("1 234,56","eu",[])==1234.56`（入口归一后仍正确）。`pytest tests/test_format_clean.py -q` → exit 0。

---

## 真机验收（管理员 / 桌面 Excel，不代跑）

沙箱验不到 OCR 真实效果，Codex **禁止声称已验证**，只写「待真机验收」。验收者做：

1. **生成模板**：上传一张真实发票图片（不选模板）→ 任务窗格出现「据此生成模板」→ 点开看到自动填好的字段名/类型/来源 → 只做少量修正（改名/改类型）→ 保存。确认字段名来自文档本身（表头/键名），非内置写死。
2. **两 Sheet 还原**：选该模板再上传同一发票 → 进工作簿应得两张 Sheet：`*-抬头`（字段/值两列，含发票号/日期/价税合计）与 `*-明细`（表头 + 逐行数据）。金额列是**数值**（可 `=SUM`），日期是日期或干净 ISO 字符串。
3. **本地为主**：断网/无 `DASHSCOPE_API_KEY` 时上传 → 本地仍能生成模板 + 两 Sheet（准确度允许低于云）。
4. **云可选**：配了 API key 时选「云端 OCR」→ 难文档识别更准，且不再出现 `|---|---|` 分隔行混入数据。
5. **预处理**：上传一张手机随手拍的倾斜/暗光发票图 → 本地识别率应明显好于未预处理（可对照关闭预处理）。
6. **向后兼容**：旧 doc-recipe 模板（P0 手写、无 group）上传 → 仍按位置对齐进单张明细表，不崩。
7. **重启持久**：保存的模板重启后仍在（`~/.claude-excel-web/doc-recipes/`），`group`/`source` 字段完整。

## 收尾

1. `cd backend && python -m pytest tests/ -q` → exit 0（全量不回归，含 `test_skill_registry.py` 三方一致门禁）。
2. `cd addin && npm run typecheck` → exit 0；`npm run test:unit` → 全绿；`npm run build` → exit 0。
3. 提交（任务分支，每个 Task 结束时 `git add` 该 Task 涉及文件 + 一条 commit，便于 review 逐粒核对）：
   - Task 1-2: `git commit -m "feat(ocr): 图片预处理 + 布局文档模型"`
   - Task 3-4: `git commit -m "feat(ocr): 布局提取 + 类型推断/模板提议"`
   - Task 5-6: `git commit -m "feat(doc-recipe): 字段 group/source 定位 + 两 Sheet 输出"`
   - Task 7: `git commit -m "feat(ocr): 提取管线接入 sheets/proposedRecipe"`
   - Task 8: `git commit -m "feat(ui): 两 Sheet 写入 + 识别结果生成模板入口"`
   - Task 9: `git commit -m "feat(ocr): 大写金额/全角归一/多格式日期"`
4. 真机验收段留给管理员，Codex 不代跑、不标 done 时声称已验。
5. 全部通过后：按 `docs/coordination.md`，review 交回 Claude 对照本 plan 逐粒核对。
<!-- 进度 log（2026-08-30 Codex）：实现完成并合入 master（cb4a1ec）；真机验收待管理员，review 交 Claude。 -->

---

## 增量 Task 10（后续）：RapidStruct 布局+表格识别替换词盒聚类

> 本条是主 plan（Task 1-9）完成后的**独立增量**，单独建分支执行，不改已验收行为。目标：用 [RapidOCR / RapidStruct](https://github.com/RapidAI/RapidOCR)（PaddleOCR PP-Structure 的 ONNX 轻量版）的**布局检测 + 表格识别**替换 [layout_extract.py](backend/layout_extract.py) 里 tesseract 词盒聚类（best-effort v1），产出同一 `LayoutDocument`。tesseract 降级为兜底。

**背景 / 已核实事实：**

- 现状 `layout_extract.cluster_words` 靠 tesseract `image_to_data` 词盒 + 空隙聚类分行分列，对不规则单据（键值/多表/合并单元格）不准，是「可用」而非「好用」的主因。
- RapidOCR/RapidStruct 是 PaddleOCR 模型的 ONNX 版，含 `RapidLayout`（版面区域分类）、`RapidTable`（表格结构识别，输出 HTML/cells）、`RapidFormula`、`RapidOCR`（文字检测识别）。**不依赖 PaddlePaddle/torch**，`onnxruntime` 即可，Windows 本地好装——贴合「本地为主、不加重量依赖」。
- **RapidStruct 无 SER/键值抽取**（SER 是 PP-Structure 的 KIE，需 Paddle）。键值仍走现有 `_kvs_from_text` 正则，但升级为「只对版面分类出的**文本区**抽键值」，避免误吃表格单元格。
- 依赖是**可选**的：未安装/模型缺失时回退现有词盒聚类，不破坏 Task 1-9 已验收行为（`_safe_layout` 已兜异常）。
- 精确 API/包名以官方 README 为准（v2 统一包 `rapidocr` 或 v1 `rapidocr_onnxruntime`；类名/返回结构以 `python/rapid_structure/docs/README_Layout.md`、`README_Table.md` 为准）。**Codex 落地时对照核实，用单测锁行为，不要凭记忆写死接口。**

**Files:**

- Modify: `backend/layout_extract.py`（新增 rapid 路径 + 回退开关）
- Modify: `backend/requirements.txt`（新增 `rapidocr`（或 `rapidocr_onnxruntime`），注释标「可选」）
- Create: `backend/tests/test_layout_extract_rapid.py`

**Interfaces:**

- Produces: `extract_layout_from_image_rapid(image) -> LayoutDocument`；`_rapid_available() -> bool`。
- Consumes: `layout_doc`、现有 `_kvs_from_text`/`cluster_words`（回退）。

**现状缺陷：** 词盒聚类是启发式，键值/表格边界靠空隙猜，准确率上不去。

- [ ] **Step 1: 依赖探针 `_rapid_available()`** — `try: import rapidocr`（包名/导入路径以官方 README 为准）→ True；`ImportError` → False。`extract_layout_from_image` 入口按此开关分流 rapid / 词盒。
- [ ] **Step 2: 表格解析 → `TableBlock`** — 用 `RapidTable` 的 HTML/cells 输出归一成 `TableBlock(headers, rows)`：跳过 `|---|---|` 分隔行；首行全文本 → `headers`，其余 → `rows`；空表/单列/畸形输出不抛异常。
- [ ] **Step 3: 键值抽取 → `kvs`** — 用 `RapidLayout` 分类出的**文本区** OCR 文本走 `_kvs_from_text`（label 短 + `:：` 分隔）；表格区文本不参与键值抽取。
- [ ] **Step 4: 组装 + 静默回退** — 组装 `LayoutDocument(kvs, tables, raw_text=全文)`；rapid 任一步抛异常 → 回退 `cluster_words`（沿用 `_safe_layout` 兜底，绝不破坏现有 flow）。
- [ ] **Step 5: 单测 `test_layout_extract_rapid.py`** — mock `RapidLayout`/`RapidTable`/`RapidOCR` 返回固定数据：(a) 表格 → 正确 `TableBlock`（分隔行被跳、表头归 headers）；(b) 文本区 → `kvs` 正确；(c) rapid 不可用 → 走 `cluster_words` 回退；(d) rapid 抛异常 → 回退不崩。`cd backend && python -m pytest tests/test_layout_extract_rapid.py -q` → exit 0。

**真机验收（管理员，不代跑）：** 上传真实发票图，本地 OCR 的明细表/抬头键值应明显好于 tesseract 词盒聚类；未装 rapidocr 时行为与 Task 1-9 完全一致。

**收尾：** `cd backend && python -m pytest tests/ -q` → exit 0；提交 `git commit -m "feat(ocr): RapidStruct 布局+表格识别替换词盒聚类"`。
