---
name: product-info-search
description: 网页搜索产品信息并写入 Excel（无付费 API）
slash: product-info-search
---

# 产品信息搜索

用 **web_search**（DeepSeek 服务端）定位官方商品页，再 **web_fetch** 尽力抓取；**write_to_sheet** 写入新表。只用网页搜索 + 表格写入，不调用付费 API / CLI。

## 前置

- 用户可指定产品名、品牌、ASIN 或站点；**未指定时**自动选一个热门、搜索索引较全的产品（如 Echo Dot），并在表中标注「技能自动选择」。
- 不编造价格、评分、ASIN。fetch 失败字段填 **未能获取**。

## 步骤（🟢）

1. **inspect_workbook**：确认当前表；空簿也可直接写新表。

2. **web_search**：按用户目标或自动所选产品，搜索 **官方商品页**（优先 amazon.com / walmart.com 等 `/dp/`、`/ip/` 详情 URL）。记录 title、url；从 URL 提取 ASIN/商品 ID（若有）。

3. **web_fetch**（最多 **1 次** / 每个 amazon.com|amazon.* `/dp/` URL）：
   - 成功：从正文提取当前价、评分、评论数（能确定的才填）。
   - 403 / 401 / error：**停止再抓同一 URL**；对应字段标 **未能获取**。

4. **write_to_sheet**（**本技能必须完成此步**）— 新表名如 `产品信息_<产品简称>`，列建议：

   | 字段 | 说明 |
   |---|---|
   | 产品名 | 搜索 title 或用户指定 |
   | ASIN/商品ID | URL 解析或 未能获取 |
   | 来源URL | 官方页链接 |
   | 当前价格 | 抓取值或 未能获取 |
   | 评分 | 抓取值或 未能获取 |
   | 评论数 | 抓取值或 未能获取 |
   | 备注 | 如「技能自动选择」「Amazon 403，实时价请用取数栏」 |

5. 中文汇报新表名；缺字段说明原因，引导需要实时价时用任务窗格 **取数栏** 跟手打开商品页。

## 抓取失败（强制）

- 对 **amazon.com/dp/**（及各国 amazon `/dp/`）的 web_fetch **最多 1 次**。
- 返回 403/401/error 后 **禁止**再 fetch 同一 URL；用户说「继续」也 **禁止**重复 inspect + fetch 循环。
- **立即 write_to_sheet**：能确定的字段写入；价格/评分/评论数填 **未能获取**。
- **没有写出新表不算完成**。

## 试跑口令

- `/product-info-search`
- `/product-info-search Echo Dot 第五代`
- `/product-info-search ASIN B09B8V1LZ3`

## 边界

- 🔴 登录站、验证码、要真实挂牌价：取数栏跟手操作，不进本技能。
- 🟡 多 SKU 变体、历史价格曲线：只列选项，不替用户拍板。
- 禁止把 web_search 的 JSON / encrypted_content 贴进对用户可见的回复或整页 HTML 写进表。
