# OCR 布局提取设计原则（backend/layout_extract.py）

> 长期有效。改 `backend/layout_extract.py` 或 OCR 提取管线前先读本文件。
> 来源：doc-recipe P0 + 增量 Task 10（RapidStruct）真机打磨
> （20210622111500165.jpg 等发票/单据实测，2026-08-30 ~ 08-31）。

## 核心策略（务必遵守）

1. **块聚类只用于「找噪声块」，不用于建表**。
   噪声块 = 符号密集、无汉字/字母的盒集合（如发票密码区 4 串字符）。
   先整体剔除噪声块，再用**全局行**（y1 + 全局中位盒高容差分行）建表——
   这样密码区整块排除、明细表仍完整。**不要**按块独立建表（块容差小会
   把表格各列拆散）；**不要**把噪声字符逐行混进表格。

2. **键值不依赖版面分类**。PP-Layout CDLA 会把密集发票表单整页判为
   `table`，「只从版面文本区抽键值」会全丢（曾 0 kvs）。改用：
   RapidOCR 全文按位置排序 + 通用正则 `label: value`（与单据样式无关）。

3. **整页表单区（面积 > 50%）跳过 RapidTable**，回退位置重建表格；
   只有局部表格区（文档里一块真正的表）才走 RapidTable。

4. **first_table 优先选带表头的表**（明细表），再按 行×列 大小兜底。

5. **显示文本（正文预览 / AI 解读输入 / 入知识库）用 RapidOCR 输出**。
   rapid 成功时 `extract_pdf` 的 `text` = `layout.raw_text`（RapidOCR 按位置排序，
   一字段一行），不再用 tesseract `image_to_string`；同时「进工作簿」的 rows 改用
   `layout.first_table()` 明细表（RapidOCR 文本是字段式，`_rows_from_ocr_text`
   找不到多列表格行）。旧模板 `apply_template` 对 layout 明细表行传 `has_header=True`。
   rapid 不可用/回退时保持 tesseract 文本原样，行为不变。
## 为什么（真机教训，别重踩）

- RapidOCR 盒是**行级**粒度，喂给为 tesseract **词级**盒设计的聚类逻辑
  会全崩（垂直重叠合并整页成巨行、空隙阈值吃掉列）。
- 大标题盒（如「上海市增值税电子普通发票」高 128px）会把行容差膨胀到
  ~102px 吞掉整页——行容差必须用**全局中位盒高**，不能用最大盒高。
- 密码区底边与明细表顶边仅差 ~10px，**纯几何切不开**——噪声判定必须靠
  **内容信号**（无汉字/字母 + 强符号），不是位置。
- 位置重建的 `flush()` 在短 run 时也必须清空 run，否则单行残留会并入
  下一张表（曾 t2=[9,10,11] 的 bug）。

## 判定常量（backend/layout_extract.py 内）

| 常量 | 值 | 含义 |
|---|---|---|
| `STRONG_NOISE_CHARS` | `<>*+{}[]^~\#@&` | 强符号集（噪声信号） |
| `WHOLE_FORM_AREA_RATIO` | `0.5` | 整页表单区阈值（跳过 RapidTable） |
| `MIN_TABLE_CELLS` | `3` | 表格行最少单元格数 |
| 行容差 | `max(8, 全局中位盒高*0.6)` | y1 分行容差 |
| 块容差 | `max(12, 中位盒高*1.5)` | 噪声块聚类容差 |

## 验证门禁

- 单测：`backend/tests/test_layout_extract_rapid.py`（mock + 真实引擎双轨，
  密码区/噪声块/整页表单/位置回退均有用例）
- 真机：venv 装 `rapid-layout rapid-table rapidocr` 后跑真实发票
  （`python -m pytest tests/test_layout_extract_rapid.py -q` 在 venv 全绿）
- 全量：`cd backend && python -m pytest tests -q`

## 已知边界

- 「表单标签行 vs 真表格」的判别是启发式（靠列数一致性切分），顶部
  「网/上海/章/开票日期」等标签行可能聚成无用表 t1——它不会被
  `first_table` 选中，不影响模板/写簿；更难的判别交给 AI 解读/模板步骤。
