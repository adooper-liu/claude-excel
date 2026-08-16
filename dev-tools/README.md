# dev-tools — 开发工具

> 这些工具**不进用户安装路径**，不在 Pack 内。仅用于开发/测试/录屏。

## gen_dirty_fixtures.py

按已验证脏数据特征逐行构造 CSV fixture（Gate 1b 回归测试数据工厂）。

**脏数据即基准**：`orders.csv` / `ads.csv` 就是脏数据（50/42 行），pytest 和录屏统一用这一套，不再区分「干净测试」和「脏演示」。

### 用法

```bash
python dev-tools/gen_dirty_fixtures.py
```

直接覆盖 `orders.csv` / `ads.csv` + 生成 `假设参数.csv`。

### 输出

| 文件 | 路径 | 用途 |
|---|---|---|
| `orders.csv` | `samples/packs/cross-border-ecommerce-finance/connector/fixtures/` | 50 行订单，覆盖 8 类脏特征 |
| `ads.csv` | 同上 | 42 行广告，覆盖广告特有脏特征 |
| `假设参数.csv` | 同上 | 参数 sheet 默认值（汇率/佣金/FBA/退款率） |

### 何时跑

- 每次改 `connector-csv-local/handler.py` 后 → 重跑 + `pytest backend/tests/test_connector_load_feed.py`
- 每次改 `reconcile_tables` 核心算子后 → 重跑 + 验证
- 新增脏特征时 → 在生成器加一行 → 重跑 → 验证

脏数据覆盖的演示点：SKU 尾空格/大小写、日期格式、金额 N/A、退款行、多币种、长 ID、重复行、orphan SKU、归因偏移等（详见 `knowledge/dirty_patterns.md`）。