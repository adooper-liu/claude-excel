# 脏数据特征与处理规则

> 全网共识 · 已验来源。connector/load 引此文件做编码探测与列清洗；SKILL.md 引此文件做异常处理话术。

---

| # | 特征 | 具体表现 | 处理规则 | 阻断？ | 来源 |
|---|------|---------|---------|--------|------|
| 1 | **SKU 命名不一致** | 大小写混用（`abc123` vs `ABC123`）、尾空格、平台规则不同（Amazon 允许 `-_`，Temu 强制含工厂码，SHEIN 绑供应商 ID） | connector 内 `trim + lower` 归一，输出 `platform_sku` 统一列 | 否 | 阿里白皮书 2023 / 10100 平台对比 |
| 2 | **编码乱码** | Ozon 默认 UTF-8-BOM 双击变 ANSI；店小秘导出常 GBK；Amazon 美区 UTF-8；含中文列名 CSV 打开乱码 | `load` 编码探测 fallback：UTF-8 → GBK → Latin1；三套全失败则拒，提示重存 | 是（全失败时） | Ozon 卖家帖 / 店小秘实操 |
| 3 | **日期格式混排** | `2026/1/15` / `2026-01-15` / `2026-01-15 00:00:00 UTC` 同批文件混用 | connector 内统一为 `YYYY-MM-DD`；时区字段截取日期部分，标记时区来源 | 否 | 智立方 Codex 复盘 / 今日头条对账断裂文 |
| 4 | **金额脏值** | `$0.00` / `¥199.00元` / 空 / `N/A` / 科学计数法（`1.23E+11` 订单号被当金额） | 去币符 → `coerce number`；空→`""`；`N/A`→标记异常行不参与计算；科学计数法长数字→保留字符串 | 是（标记不阻断） | 卖家实操帖 / 速卖通 SKU 乱码文 |
| 5 | **状态枚举爆炸** | `Pending` / `Shipped` / `Cancelled` / `Refunded` / `PartialRefund` / `Closed` / `SettlementAdjustment` 各平台叫法不同 | connector 内映射到 5 个 Pack 枚举（`completed / refunded / partial_refund / cancelled / pending`）；原始值存 `raw_erp_status` 审计列 | 否 | 跨境支付孤岛综述 |
| 6 | **ID 不共线** | 交易流水号 ≠ 结算批次号 ≠ 付款 ID；广告报表无 SKU 列（Search Term 报告只有 keyword） | 对账 JOIN 只用 `platform_sku + biz_date`；Search Term 报告 Phase 1 不接；ID 字段只进审计列 | 否（Phase 1 不接 Search Term） | 智立方 / Synder 官方博文 |
| 7 | **退款行异常** | 金额为负、部分退款拆两行、退款按退款日汇率算（两头亏汇损） | `refund_amount > 0` 优先用实值；否则 `platform_status` 含退款标记→用参数 sheet 退款率估算；`completed`→不计算退款 | 否（标记不阻断） | taocarts 代购实操 |
| 8 | **粒度断裂** | 订单按行、广告按 SKU+日、结算按批次、库存按 SKU+仓库——JOIN 键天然不对齐 | Phase 1：订单×广告按 `sku+date` 精确 JOIN，归因偏移见 `profit_formula.md`；Phase 2：结算按批次 JOIN | 否（标注不解决） | 今日头条断裂复盘 / qeasy 技术挑战 |

---

## 附加：编码探测顺序与处理

```
UTF-8-BOM → UTF-8 → GBK → Latin1
     ↓ 全失败
  拒：提示用户用 UTF-8 或 GBK 重新保存
```

## 附加：日期归一规则

1. `YYYY-MM-DD` → 原样保留
2. `YYYY/MM/DD` → 替换 `/` 为 `-`
3. `YYYY-MM-DD HH:MM:SS UTC` → 截取前 10 字符
4. 其他格式 → 保留原字符串，不猜测

## 附加：SKU 归一规则

1. `strip()` 去首尾空格
2. `lower()` 转小写
3. 不做其他转换（不删特殊字符、不截断）