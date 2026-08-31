# OCR 引擎打磨路线图（doc-recipe / RapidStruct）

> 长期有效。后续会话对 OCR 引擎继续打磨前，先读本清单 + `docs/ocr-layout-design.md`
> （设计原则/真机教训/常量）。勾选状态：`[x]` = 已合 master，`[ ]` = 待办。
> 提交号 = 合入 master 的 commit（均为本仓库 `master` 上可查的历史）。

> # ⛔ 维护态（2026-08-31，最高优先级）
>
> **OCR 进入维护态：启发式适配冻结**（详见 `docs/ocr-layout-design.md` 顶部冻结决策）。
> 不再为适配新单据版式新增几何/布局/表格启发式；新单据适配走 **AI 解读 / 模板 / 云 doc-parse**。
> 本清单中标记「⛔冻结」的项不再实施；未标记项仅在真 bug / 纯维护范围内处理。

## 主线一句话

**RapidOCR 换引擎 → 数据驱动布局（块/噪声/位置重建）→ 列对齐保正确 →
显示与进簿统一用 RapidOCR → 模板位置锚点增强**——OCR 对象多变，机制必须通用，
不针对单一单据样式。

---

## 已定案并实现（7 条）

- [x] **① OCR 引擎切换：RapidOCR / RapidStruct 替代 tesseract（可选、静默回退）** `f7620de`
  - `rapid_layout` + `rapid_table` + `rapidocr` 三包；未装/模型缺失/异常 → 静默回退
    tesseract 词盒聚类，不破坏原有行为（`_rapid_available` / `extract_layout_from_image_rapid`）。

- [x] **② 通用布局机制（数据驱动，不针对单一单据）** `6f24fbf` `be2eb19`
  - 键值 = RapidOCR 全文正则（不依赖版面分类——密集表单会被整页判为 table）。
  - **噪声块识别**：无汉字/字母 + 强符号（`<>*+{}[]^~\|#@&`）的盒聚类成块
    （如发票密码区 4 串字符），**按块整体剔除**后再用全局行建表。
  - 整页表单区（面积 > 50%）跳过 RapidTable → 位置重建；局部表格区仍走 RapidTable。
  - 行按 y1 + 全局中位盒高容差分行（防大标题盒膨胀容差吞整页）。
  - `first_table` 优先选带表头的表（明细表）。

- [x] **③ 位置重建表格列对齐（进工作簿正确性）** `a6651d0`
  - 参差行按 x 贪心对齐表头参考列（冲突回退次近列、缺列补空串）→ 不再整行左移错位。

- [x] **④ 显示文本 = RapidOCR 输出** `1e5657b`
  - 正文预览 / AI 解读输入 / 入知识库 = `layout.raw_text`（RapidOCR 字段式）；
    进工作簿 rows = rapid 明细表（带表头，`apply_template` 传 `has_header=True`）。

- [x] **⑤ 界面显示识别引擎** `6925f34`
  - 解析卡显示「识别引擎：RapidStruct（版面+表格）/ tesseract（回退）/ doc-parse / …」。

- [x] **⑥ 安装体验修复** `0304ce9` `7f4ddbe`
  - `%PATH%` 含 `(x86)` 拆散 if 块崩溃修复；`setx` 截断改 PowerShell 安全追加；
    winget「已装无升级」不再误报；install.bat 自动装 rapid 三包（失败不阻塞）。

- [x] **⑦ 设计文档固化** `54ddd98` `9e78467`
  - `docs/ocr-layout-design.md`：核心策略 6 条 + 真机教训 + 判定常量 + 验证门禁；
    模板打标记最佳实践已定案。

## 已定案、待实现（1 条）

- [x] **⑧ 模板打标记定位（position 锚点）— 已决策回退删除（方向 B）**
      评估后价值低（前端不透传、语义已覆盖、漂移会静默错值），见 `docs/ocr-layout-design.md`
  - [x] ~~ 模板字段加可选 `position`：创建模板时自动记录归一化锚点（0..1 相对坐标，
        detail 可相对表格 bbox），不存绝对像素。~~（已删除）
  - [x] ~~ 解析时对照本次 OCR 盒图就近匹配（容差 ±10~15%）：语义匹配失败/歧义时兜底。~~（已删除）
  - [x] ~~ 置信合并、永不硬门禁：语义+位置一致→高置信；只有一个→取用；都无→空值。~~（已删除）
  - [x] 模板模式下跳过 RapidLayout/RapidTable，只留单次全图 RapidOCR
    （extract_layout_from_image_light；无表时回退完整路径；冷启动省 ~4s，省掉
    layout/table 两个模型族的内存与加载）
  - [ ] ⛔引擎实例缓存（后续 Task）——维护态暂缓，需先验证线程安全
  - [x] ~~ 异常路径才裁剪期望区域高 DPI 重 OCR（默认不触发）。~~（已删除）
  - [x] ~~ 单测：mock 盒图 + 锚点 → 语义失败时位置命中、漂移时回退语义。~~（已删除）

## 遗留待办 / 验证（未定）

- [x] 真机发现并修复（2026-08-31）：US-CA 装车卸车发票模版.pdf（中英双语文本层 PDF）
      原 pdfplumber 只出 2 行垃圾 → 本地 kind=table 且 pdfplumber 表格弱时改渲染页 +
      RapidOCR light 管线（`_pdf_pages_rapid_layout`），正文可读 + proposedRecipe 字段正确。
- [x] 语言无关「标注标签 → 模板字段」提示词增强（2026-08-31）：模板 PDF 内人工标注
      （任意语言，如英文表单配中文标注）作为字段名 name、表单原始标签作 source，
      由 LLM 跨语言识别，不硬编码语言/文字；法/德/中/英表单均适用。
- [ ] **真机验收（管理员）**：用多种单据验证 rapid 通用性；发现识别明显不对的
      单据，结果走 **AI 解读 / 模板 / 云 doc-parse** 处理——⛔不新增启发式适配。
- [ ] ⛔**表单标签行 vs 真表格的判别**（顶部 t1 无用表）：冻结，不再做几何判别，
      交给 AI 解读/模板步骤。
- [ ] **tesseract 最终定位**：倾向保留为纯兜底（rapid 三包未装时仍可用），未最终拍板。
- [ ] **正文预览字数变化**（1280 → 591，字段式更干净）：已知，非缺陷。

## 验证门禁（每次改动后）

```bash
cd backend && python -m pytest tests -q          # 全量（base 环境）
backend\.venv\Scripts\python.exe -m pytest tests/test_layout_extract_rapid.py -q  # 真实引擎
```
- 改 `layout_extract.py` 前先读 `docs/ocr-layout-design.md`（核心策略 6 条）。
