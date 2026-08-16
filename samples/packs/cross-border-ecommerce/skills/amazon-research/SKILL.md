---
name: amazon-research
description: Amazon 搜索取数后的列规整与透视（可选示例技能）
slash: 亚马逊选品
---

# Amazon 选品（示例）

方法论（SERP 格局、利润 11 项、VOC 六维）见仓库 `samples/industry-deconstruct-appendix.md` — 请上传**知识库**或 `/调研` 对照，**本技能只编排已有算子**。

## 前置

- 已在 `amazon.com` 搜索页用**取数栏/扩展**写入表（如 `取数_amazon.com`），或用户导入等价 CSV。
- 不编造 FBA 费率、佣金、关税；数字须标注来源或「用户提供」。

## 步骤（🟢）

1. **inspect_workbook** → **inspect_table**：确认 `取数_*` 表头与 `columns[].index` / `sampleRows`（表体不进对话）。

2. **reshape_table** `op=project`，`headerless:true`，写出新表（默认 `*_规范`）— 列映射对齐 `recipe/hosts/amazon.com.yml`：
   - 排名 ← 0；标题 ← 1；尺码数 ← 3；评分 ← 5（coerce number）；评论数 ← 7；月购买 ← 8
   - 售价 ← merge [11,12,13] separator "" coerce number；市场价 ← 21；配送费 ← 24

3. **create_pivot**：按用户指定的行/列字段切片（价带、配送方式等）；口径只列选项，不替用户拍板。

4. **（可选）write_inputs** + **calculate_table**：用户自备假设格（汇率、头程、TACoS、退货率）后写活公式到新表；见附录「利润 11 项」。

## 试跑口令

- `/亚马逊选品 把取数表收成九列并按配送方式透视`
- `取数_amazon.com 已写好，按站点 recipe 做 project 规整`

## 边界

- 🔴 自动翻页回放、登录验证码：人工 + 取数栏，不进本技能。
- 🟡 38 维 SERP 全量、外部货源价：人判是否买数据；可用 `/调研` 或知识库片段。
- 冲突行、缺失列：inspect 后向用户列 2–3 个选项。
