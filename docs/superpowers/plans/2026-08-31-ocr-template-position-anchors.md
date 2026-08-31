---
status: closed
---
# 模板 position 锚点：语义为主、位置兜底（2026-08-31）

> 来源：docs/ocr-polish-roadmap.md ⑧（已定案最佳实践，见 docs/ocr-layout-design.md
> 「模板打标记定位：最佳实践」）。本文档把 ⑧ 拆成可执行任务，逐 Task 实现。

**目标：** 模板字段增加**归一化 position 锚点**，创建模板时自动记录、解析时
在本次 OCR 盒图里就近匹配做兜底/消歧；语义匹配（source=标签/列头）仍是主干，
位置永不硬门禁。**本轮不做**「模板模式跳过 RapidLayout/RapidTable」效率优化
（roadmap ⑧ 的子项，单独 Task）。

**为什么：** 同名歧义（购买方/销售方都有「名称」）与 OCR 标签错字（「名 称」）
是语义匹配的痛点；归一化锚点 + 盒图就近查能零额外 OCR 解决。

**Files:**
- Modify: `backend/layout_doc.py`（KVItem/TableBlock 带可选位置）
- Modify: `backend/layout_extract.py`（提取时记录位置：kvs→盒、列→x-center）
- Modify: `backend/recipe_propose.py`（propose_recipe 写入 field.position）
- Modify: `backend/doc_recipe.py`（schema 校验/保留 position）
- Modify: `backend/format_clean.py`（apply_recipe 位置兜底）
- Create: `backend/tests/test_template_position.py`

**关键约束（docs/ocr-layout-design.md 最佳实践）：**
- position = 归一化 0..1 相对坐标（detail 可相对表格 bbox），不存绝对像素
- 解析顺序：语义 → 位置兜底/消歧 → 置信合并；永不硬门禁
- 位置漂移就静默回退语义，绝不让提取失败

- [x] **Task 1: 数据模型带位置** — `KVItem` 加 `position: tuple[float,float,float,float]|None`；
      `TableBlock` 加 `column_positions: list[float]|None`（列 x-center 归一化）；
      to_dict/from_dict 同步；`LayoutDocument` 可选 `image_size`（归一化基准）。
- [x] **Task 2: 提取时记录位置** — `_layout_from_rapid`：kvs 用 label 前缀匹配 OCR 盒
      记录归一化 position；位置重建表格把列 x-center 归一化写进 TableBlock.column_positions。
      tesseract 路径（cluster_words）不记录位置（返回 None，不破坏）。
- [x] **Task 3: 模板创建写入 position** — `propose_recipe` 为 header 字段写
      `position`（来自匹配 kv 的盒位置）、detail 字段写列 position（相对表格 bbox 或文档）。
- [x] **Task 4: schema 校验保留 position** — `_normalize_fields` 校验 position
      （4 个 0..1 数字或 null），非法则丢弃（不影响旧模板）。
- [x] **Task 5: 解析位置兜底** — `_header_sheet`/`_detail_sheet`：语义匹配失败/歧义时
      用 field.position 在布局盒图里就近找（容差 ±10~15%）；两者都无→空值；
      永不硬门禁。
- [x] **Task 6: 单测 `test_template_position.py`** —
      (a) 模板往返保留 position；(b) 语义失败时位置命中（mock 盒图）；
      (c) 位置漂移回退语义不失败；(d) 旧模板无 position 行为不变。
      `cd backend && python -m pytest tests/test_template_position.py -q` → exit 0。

**真机验收（管理员）：** 用同一发票建模板 → 重传同款发票（轻微缩放/偏移）→
抬头/明细字段仍能取到值；把「名称」这类同名字段在不同位置的单据上验证消歧。

**收尾：** `cd backend && python -m pytest tests -q` → exit 0；
提交 `git commit -m "feat(ocr): 模板 position 锚点（语义为主、位置兜底）"`。

## 进度 log

- 2026-08-31 完成 Task 1-6（分支 feat/ocr-template-position）：
  KVItem/TableBlock 带归一化位置；_layout_from_rapid 记录 kv 位置（顺序盒匹配）与列 x-center；
  propose_recipe 写 field.position；_normalize_fields 校验保留 position（非法丢弃）；
  _header_sheet/_detail_sheet 语义失败时位置兜底（容差、永不硬门禁）。
  真机：发票 7/14 键值带位置、明细表 8 列 column_positions、proposal 15/21 带 position、
  语义 source 故意改错仍经位置取到 02948319。门禁：后端 347 passed + 2 skip，venv 28 passed。
  效率优化「模板模式跳过布局模型」留 roadmap ⑧ 子项，未做。
> **结案（2026-08-31 方向 B）**：position 锚点经评估价值低（前端不透传、语义已覆盖、
> 漂移会静默错值），已按 `refactor(ocr)` 提交回退删除；位置重建表格/列对齐/噪声块/
> 模板轻量路径保留。本 plan 不再执行。
