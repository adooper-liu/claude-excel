---
status: partial
---
# 文档 OCR 减重：砍 `position` 空间锚点 + 收敛表格重建路径（2026-08-31）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 OCR 从「~4000 行、三条表格重建路径、手写坐标锚点」减回「两条路径、语义匹配 + 模型布局」。砍掉刚加的 `position` 空间锚点（`[x1,y1,x2,y2]` 归一化 + 最近邻 + 容差）和「从 RapidOCR 行级盒位置重建表格」那一套启发式，回到 `source` 语义匹配 + RapidTable 模型布局 + tesseract 词盒兜底。**不改已验收行为，只删过度设计。**

**Architecture（减后）：**

```
表格重建 = 两条路径（原三条）：
  1. RapidTable（HTML → TableBlock）            # rapid 已装时的主路径
  2. tesseract 词盒聚类 cluster_words            # rapid 未装时的兜底
  （删掉：从 RapidOCR 盒位置重建表格 _tables_from_rapid_blocks 整条链）

字段定位 = 语义 + 位置回退（原三层）：
  1. source 表头名匹配（normalize_key）
  2. index 位置对齐（source 空/匹配不上时）
  （删掉：position 空间最近邻 fallback _kv_by_position / _column_by_position）

抬头键值 = source 键名匹配（kv 无 position）
```

**Context / 已核实事实（不要重测）：**

- `position` 是**后端专属**：前端 [DocRecipeBar.tsx](addin/src/taskpane/components/DocRecipeBar.tsx) 的 `DocRecipeField` 类型无 `position`，`parseFieldsText` JSON 分支只复制 `name/type/source/format/group`，**不复制 position**。所以 `propose_recipe` 生成的 position 在前端往返时已丢失，砍它**零前端影响**。
- 表格重建的三条路径都在 [layout_extract.py](backend/layout_extract.py)：① `_table_from_html`/`_rapid_table_block`（RapidTable HTML）；② `_tables_from_rapid_blocks` → `_rows_from_items_x` → `_align_row_to_columns` → `_tables_from_positional_rows_x`（从 RapidOCR 行级盒位置重建，整条 ~370 行）；③ `cluster_words`/`_group_table_lines`（tesseract 词盒，原 Task 3）。
- 位置重建只在 `_layout_from_rapid` 的 `if not tables: tables = _tables_from_rapid_blocks(...)` 处被调用（「整页表单 RapidTable 会乱 → 位置兜底」）。砍掉后，整页发票（本地 rapid）**只出键值、无明细表**——这是接受的退化，云 doc-parse 仍能处理这类单据。
- `_rows_from_rapid_ocr`（`layout_extract.py`）在生产代码里**已无人调用**（死代码），一并删。
- 涉及测试：`tests/test_template_position.py`（~190 行，整文件删）、`tests/test_layout_extract_rapid.py` 的位置兜底用例、`tests/test_doc_recipe.py` 的一处 position 注释/断言。
- `recipe_propose.py` 里 position 生成：`_detail_fields` 从 `table.column_positions` 生成 `field["position"]`、kv 分支从 `kv.position` 生成——删后 `propose_recipe` 仍产出 `name/type/source/group`，前端照常。

## Global Constraints

- **减重不改已验收**：`source` 语义匹配 + `index` 位置回退、两 Sheet 输出、生成模板、引擎打标（`layout.engine`）全部保留。
- **接受退化**：整页发票在本地 rapid 路径下不再有明细表（位置重建被删），这是**明确的、被接受的降级**，靠云 doc-parse 或未来更强的布局模型解决，**禁止**为它再手写坐标/容差/最近邻。
- **不新增启发式**：本 plan 只删，不加任何新的位置/坐标逻辑。

---

### Task 1: 砍 recipe 的 `position` 字段

**Files:**
- Modify: `backend/doc_recipe.py`
- Modify: `backend/layout_doc.py`
- Delete: `backend/tests/test_template_position.py`
- Modify: `backend/tests/test_doc_recipe.py`

**Interfaces:**
- 删除：`doc_recipe._normalize_position`；`_normalize_fields` 里读 `position` 的块；`layout_doc.KVItem.position`、`TableBlock.column_positions` 及 `to_dict/from_dict` 中对应字段。

**现状缺陷：** `position` 空间锚点手写版式规则，重复造 RapidStruct 布局模型的轮子，且前端不透传。

- [ ] **Step 1: `doc_recipe.py`** — 删 `_normalize_position`（95-107 行）与 `_normalize_fields` 里 `position = _normalize_position(...)` 那段（82-87 行）。
- [ ] **Step 2: `layout_doc.py`** — 删 `KVItem.position`、`TableBlock.column_positions` 字段定义，及 `to_dict`/`from_dict` 里对应键。
- [ ] **Step 3: 删 `test_template_position.py`**（整个文件）。
- [ ] **Step 4: `test_doc_recipe.py`** — 去掉任何 position 相关断言/注释（`recipe()` helper 若含 position 一并去）。
- [ ] **Step 5: 门禁** — `cd backend && python -m pytest tests/test_doc_recipe.py -q` → exit 0（此时 `format_clean`/`layout_extract` 尚未动，相关引用会红，故先只跑本文件，等 Task 2/3 完成再全量）。

---

### Task 2: 砍 `format_clean` 的 position fallback

**Files:**
- Modify: `backend/format_clean.py`
- Modify: `backend/tests/test_format_clean.py`

**Interfaces:**
- 删除：`_kv_by_position`、`_column_by_position`；`_detail_sheet` 与 `_header_sheet` 里的 position fallback 分支。

**现状缺陷：** 三层定位（source→position→index）里中间那层是手写最近邻，价值存疑。

- [ ] **Step 1** — 删 `_kv_by_position`（132-153）与 `_column_by_position`（156-171）。
- [ ] **Step 2: `_detail_sheet`** — 去掉 `if column is None and field.get("position"): column = _column_by_position(...)`（187-188），保留 `source` 匹配 → `index` 回退。
- [ ] **Step 3: `_header_sheet`** — 去掉 `if raw is None and field.get("position"): raw = _kv_by_position(...)`（208-209）。
- [ ] **Step 4: 单测** — `test_format_clean.py` 若含 position 用例则删；确认 `source` 匹配与 index 回退用例仍在。`pytest tests/test_format_clean.py -q` → exit 0。

---

### Task 3: 砍 `layout_extract` 的位置重建

**Files:**
- Modify: `backend/layout_extract.py`
- Modify: `backend/tests/test_layout_extract_rapid.py`

**Interfaces:**
- 删除函数：`_rapid_items`、`_rows_from_items`、`_rows_from_items_x`、`_rows_from_rapid_ocr`、`_align_row_to_columns`、`_tables_from_positional_rows_x`、`_tables_from_positional_rows`、`_tables_from_rapid_blocks`、`_noise_blocks`、`_is_noise_text`、`_attach_kv_positions`。
- 删除常量：`MIN_TABLE_CELLS`、`STRONG_NOISE_CHARS`。
- 保留：`WHOLE_FORM_AREA_RATIO` + `_region_area_ratio`（整页表格仍跳过 RapidTable，避免乱格）、`_rapid_ocr_lines`（raw_text/kvs）。
- `_layout_from_rapid` 简化为：raw_text + `_kvs_from_text` → RapidTable（跳过整页区）→ 不再做位置兜底。

**现状缺陷：** 位置重建 ~370 行是「RapidOCR 行盒 → 行 → 列对齐」的手写表格检测，重复造 RapidTable 的轮子。

- [ ] **Step 1: 删位置重建链** — 删上面 11 个函数 + 2 个常量。确认删后 `layout_extract.py` 无 `position`/`column_positions`/`_tables_from_positional`/`_align_row_to_columns` 残留引用。
- [ ] **Step 2: 简化 `_layout_from_rapid`** — 保留 raw_text/kvs 生成与整页区跳过；删 `if not tables: tables = _tables_from_rapid_blocks(...)`；删 `_attach_kv_positions(...)` 调用。RapidTable 跑不到表时，`tables` 就为空（不兜底）。
- [ ] **Step 3: 单测 `test_layout_extract_rapid.py`** — 删/改以下用例：`test_rapid_empty_table_html_falls_back_to_positional`、`test_rapid_table_region_crash_falls_back_to_positional`、`test_positional_rows_split_on_cell_count_divergence`，以及任何引用 `_tables_from_positional_rows`/`column_positions`/`position` 的用例；保留 `test_rapid_builds_table_and_kvs`（含 `engine == "rapid"`）、HTML 解析、ndarray、回退、冒烟测试。`pytest tests/test_layout_extract_rapid.py -q` → exit 0。

---

### Task 4: 砍 `recipe_propose` 的 position 生成

**Files:**
- Modify: `backend/recipe_propose.py`

**Interfaces:**
- 删除：`_detail_fields` 里从 `table.column_positions` 生成 `field["position"]` 的分支；kv 分支里从 `kv.position` 生成 `field["position"]` 的分支。

**现状缺陷：** 提议模板里生成 position，但前端不透传，纯浪费。

- [ ] **Step 1** — 删两处 position 生成；`propose_recipe` 产出回归 `name/type/source/group`（无 position）。
- [ ] **Step 2: 单测** — `pytest tests/test_recipe_propose.py -q` → exit 0（确认提议字段无 `position` 键，其余不变）。

---

## 真机验收（管理员，不代跑）

1. **回归（核心）**：选一个带表头名匹配的模板上传单据 → 明细列仍按 `source` 正确对齐（语义匹配没被砍坏）；无 rapid 时上传 → tesseract 词盒仍出表格。
2. **RapidTable 主路径**：装了 rapid 三包时上传带边框表格的图 → RapidTable 仍出正确 `TableBlock`；任务窗格仍显示「RapidStruct（版面+表格）」。
3. **接受退化**：本地 rapid 上传整页发票图 → 抬头键值在、明细表为空（不再有位置重建）。确认这是可接受降级，云 doc-parse 仍能出明细。
4. **零前端影响**：生成模板 → 提议字段仍含 name/type/source/group，保存/应用不报错。

## 收尾

1. `cd backend && python -m pytest tests/ -q` → exit 0（全量不回归，含 `test_skill_registry.py` 三方一致门禁）。
2. `cd addin && npm run typecheck` → exit 0；`npm run test:unit` → 全绿（本 plan 不动前端，跑一遍确认）。
3. 提交（一条 commit）：`git add` 上述文件，`git commit -m "refactor(ocr): 砍 position 空间锚点 + 收敛表格重建为 RapidTable/词盒两条路径"`。
4. 按 `docs/coordination.md`，review 交回 Claude 对照本 plan 逐粒核对。
> **执行状态（2026-08-31，方向 B）**：仅采纳「砍 position 锚点」部分（Task 1/2/4 +
> `_attach_kv_positions`/列 position 记录 + 删 test_template_position.py），已由
> `refactor(ocr): 回退 position 空间锚点（方向 B）` 完成。
> **明确不作废（永久保留）**：Task 3「砍位置重建 + 噪声块」——位置重建表格/列对齐/
> 噪声块/模板轻量路径是修整页发票明细表/进工作簿错位/密码区噪声的关键，**以后也不做**。
