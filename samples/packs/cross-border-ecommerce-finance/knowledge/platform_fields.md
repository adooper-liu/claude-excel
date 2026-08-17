# 平台字段映射（Pack canonical）

> Phase 1：`user.connector_load_feed` 读 `connector/fixtures/*.csv`，输出列见 `connector/feeds/*.schema.json`。  
> ERP 原始列名差异在 connector 内映射，**recipe 只认 canonical 列**。

## canonical 列名（唯一契约，以 feeds/*.schema.json 为准）

- **订单**：`order_id` · `order_date` · `platform_sku` · `asin` · `quantity` · `item_price` · `currency` · `order_status` · `is_refund` · `biz_date`
- **广告**：`ad_date` · `platform_sku` · `campaign_id` · `spend` · `currency` · `impressions` · `clicks` · `biz_date`

> 任何平台映射 / SKILL / recipe 一律用这些列名，**不得另起别名**（`sku` / `gross_amount` / `platform_status` 这些名字不存在）。新增列先加 `feeds/*.schema.json`，再改 connector 映射。

## 对账 join 键

| 列名 | 订单表 | 广告表 | 规则 |
|---|---|---|---|
| `platform_sku` | ✅ | ✅ | trim + lower |
| `biz_date` | 来自 `order_date` | 来自 `ad_date` | ISO `YYYY-MM-DD` |

**不做**模糊窗口 JOIN；匹配率 < 100% 时 `_pack_audit` 标注「毛利为近似口径」。

## 常见 ERP 列别名（connector 内）

| canonical | 别名示例 |
|---|---|
| `order_id` | 订单号 |
| `platform_sku` | sku, seller_sku |
| `item_price` | price, 单价 |
| `spend` | cost, 广告费 |
| `ad_date` | click_date, 点击日 |

## 异常路径（fixture 故意覆盖）

1. **退款**：`is_refund=true`，金额为负 — 利润公式需扣减或过滤。
2. **混合币种**：`currency=EUR` 等 — 走 `假设参数` 汇率，标注来源「用户提供/待验证」。
3. **SKU 不一致**：左表 `orphan-sku`、右表 `mismatch-sku` — 产生 `left_only` / `right_only`。
