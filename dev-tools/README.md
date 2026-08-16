# dev-tools — 开发工具

> 这些工具**不进用户安装路径**，不在 Pack 内。仅用于开发/测试/录屏。

## gen_dirty_fixtures.py

按已验证脏数据特征逐行构造 CSV fixture（Gate 1b 回归测试数据工厂）。

### 用法

```bash
python dev-tools/gen_dirty_fixtures.py
```

### 输出

| 文件 | 路径 | 用途 |
|---|---|---|
| `orders_dirty.csv` | `samples/packs/.../connector/fixtures/` | 50 行订单，覆盖 8 类脏特征 |
| `ads_dirty.csv` | 同上 | 42 行广告，覆盖广告特有脏特征 |
| `假设参数.csv` | 同上 | 参数 sheet 默认值（汇率/佣金/FBA/退款率） |

### 何时跑

- 每次改 `connector-csv-local/handler.py` 后 → 重跑 + 验证
- 每次改 `reconcile_tables` 核心算子后 → 重跑 + 验证
- Gate 1b 录屏前 → 重跑，然后 `cp orders_dirty.csv orders.csv && cp ads_dirty.csv ads.csv`
- 录屏完成后 → `git checkout` 恢复测试用 CSV

### 不回写

生成器输出到 `_dirty.csv`（不覆盖 `connector/fixtures/orders.csv` 和 `ads.csv`，后者是 pytest 测试数据）。录屏时手动切换。