# 脏数据坑典 · 开发向技术索引

> 状态：新建成型，随实战增补 · 2026-08-19
> 消费者：**pack 作者 / skill 作者**（写 pack knowledge 或定「算子参数 vs pack 层修复」时查表）；**开发**（决定是否给底座算子加参数时查缺口）。
> 与 [pain-points.md](../pain-points.md) 的关系：pain-points 是**对外话术**（痛点+来源，销售/售前读）；本文是**开发向技术坑目录**（表现+根因+解决层）。互链不复制。
> 与 [architecture-llm-first.md](../architecture-llm-first.md) 的关系：R1–R6 是通用纪律；本文按场景收录具体坑及解法，通用根因归入 R 规则。

## 铁律

1. 每行必须有**证据**。已证实 = 仓库 commit / 本次真实数据解读 / 可回源文档；其余一律进「候选」区，禁止把未证实坑当事实收录或写进 pack knowledge。
2. 解决层固定四类：`算子参数`（底座已有旋钮）/ `技能规则`（核心技能已内建，如 calculatorSkill 解读清单）/ `需新算子参数`（缺口，待补）/ `pack 层`（pack 内 reshape 等预处理，不进底座）。
3. 新坑入典先对号 R1–R6：根因是通用规则 → 归 R 规则，不按场景特例记；确实场景特有才进本表。

## 已证实（可回源）

| 坑ID | 场景 | 表现 | 根因 | 定制解法 | 解决层 | 对应 Pack |
|---|---|---|---|---|---|---|
| D001 | 费率表单调性 | Zone 2 计重 51–63lb 价 6.98–7.64，低于 11–50lb 的 8.43——越重越便宜 | 疑似导入/录入错误 | 单调性检查公式 `=IF(本档价<上一档,"倒挂","")` 只读 flag + 红字提醒，不自动纠错 | 技能规则 | cross-border-logistics-express |
| D002 | 折后最低价口径 | 单区 51 行价低于声明下限 7.81，但最低加权均价 7.8454 ≥ 7.81 | 下限约束的是**加权均价**，不是单区价 | 加权模式取 `MAX(SUMPRODUCT(权重×各分区价), 下限格)` | 技能规则 | 同上 |
| D003 | 概率附加费折算 | 家庭住址费 2.48 但概率 95.37%，按全额加会高估成本 | 概率列被当固定费 | 折算成本 = 金额 × 概率 | 技能规则 | 同上 |
| D004 | 前导零丢零 | 编码列 `010` 变 `10`，SKU/单号对不上 | 数值化丢失文本语义 | 前导零按文本保留（通用规则，覆盖所有补零编码列） | 算子参数 | 通用 |
| D005 | 日期列误判 | 纯数字/日期串被当普通数字或反之 | 无证据推断类型 | 日期要证据（R4）；inspect_table columnHints 为准 | 算子参数 | 通用 |
| D006 | 广告归因日期窗口 | 点击日 vs 成交日差数天，精确匹配全漏 | 转化延迟 | `matchMode=date_window` + `dateWindowDays` + left/rightDateKey | 算子参数 | cross-border-ecommerce-finance |
| D007 | 文件编码乱码（feed 路径） | 中文 CSV 编码错读乱码 | 未探测编码 | connector feed 加载内置编码探测 → 归一 | 算子参数 | 通用（connector） |
| D008 | 主子表扁平排布 | 主档记录只在第 5 行，子表行 6–1054 展开；只读子表漏掉主档方案字段 | ERP 导入模板把主子表扁平排布在同一张宽表 | 解读时识别主档行与子表行块边界；导入不删主档行、子表行按方案归属关联 | 技能规则 | cross-border-logistics-express |
| D009 | 多层表头字段定位 | 4 行表头（分组/说明/英文名/中文），取错行当字段名 | 系统模板表头多层 | 取系统导入用字段行（如第 3 行英文名）为真实字段名 | 技能规则 | 通用 |
| D010 | 折扣后净价口径 | 表内价格已是折后净价（原价×0.85/0.75/0.6），再打折算错 | 模板导出即净价 | 解读时确认价格口径是净价还是原价，不重复打折 | 技能规则 | 通用 |

**来源**：D001–D003 出自 2026-08-19 UPS 快递费方案真实解读（Zone 002 倒挂、折后最低价口径、概率附加费）——对应 calculatorSkill 已内建的通用规则；D004 出自 commit `d46f0f3`（前导零文本保留）；D005 出自 [architecture-llm-first.md R4](../architecture-llm-first.md)（日期要证据）；D006 出自 [pain-points.md A3](../pain-points.md)（广告归因窗口官方定义：SP 3P 7 天末次点击 / 1P 14 天 / SB·SD 14 天点击+浏览）+ reconcile manifest `date_window`；D007 出自 [document-usage.md A 表](../document-usage.md)（connector/fixtures 加载含编码探测）；D008–D010 出自 2026-08-19 FedEx 快递方案模板解读（AOS 海外仓系统导出：主子表扁平排布 / 4 行表头 / 折后净价）。

## 候选（待验证，禁止当事实使用）

| 坑ID | 场景 | 表现 | 根因 | 拟解法 | 解决层(拟) | 对应 Pack |
|---|---|---|---|---|---|---|
| D101 | SKU 跨平台后缀/分隔符 | `ABC-123` vs `ABC_123` vs `ABC 123`；`Ltd` vs `Limited` | 平台导出规则不同 | 先 reshape 归一（去分隔符/扩展后缀），再 normalize 对账 | pack 层 | cross-border-ecommerce-finance |
| D102 | 金额数值容差 | `1.00` vs `1`、浮点累计差 0.01 量级 | 格式化 / 浮点精度 | `reconcile_tables` 已加 `compareTolerance`（金额 0.01；只作用于值列、不碰键列，0=精确向后兼容） | 算子参数（已落地 2026-08-19） | 通用 |
| D103 | 金额列名变体 | `Total` / `Amount` / `金额` / `总计` | 平台用词不一 | inspect 真实表头后再映射（一般纪律，列为坑备忘） | pack 层 | cross-border-ecommerce-finance |
| D104 | 公式引用断裂 | SUMIFS 第 51 行引用区域被插入行破坏 | 人工插行没拖公式 | 公式族分组 diff：SUMIFS 一组、VLOOKUP 一组，各自比模板 | 待定 | finance |
| D105 | 付款备注自由文本 | 发票号/比例混在备注里，正则写死覆盖不了变体 | 无结构文本 | few-shot 示例 + 枚举约束，让模型学而非硬匹配 | 待定 | cross-border-ecommerce-finance |

候选区每行须经一次真实场景验证（带证据）才能升入已证实区；升入时补证据列。

## 维护

- **谁维护**：pack 作者新增 pack 场景时先查本表有无该坑；踩到新坑补一行，证据够才进已证实区。
- **何时读**：写 pack knowledge、决定算子参数是否加、评审新 pack 覆盖度。
- **禁止**：把候选坑写进 pack knowledge 当既定事实；把通用根因当特例记（先对号 R1–R6）。

## 相关

- [pain-points.md](../pain-points.md) — 对外话术版痛点 + 来源（销售/售前）
- [architecture-llm-first.md](../architecture-llm-first.md) — R1–R6 通用纪律（解读先行/证据/对账验证/通用规则）
- [user-packs.md](../user-packs.md) — Pack 框架与三层边界
