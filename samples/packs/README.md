# 官方场景包（Pack）

按 **category** 分组、**一包装一 Gate/场景**，用户通过任务窗格或 `POST /api/user-skills/install-pack` **分别安装**。

完整规则见 [docs/user-packs.md](../../docs/user-packs.md) §10「Pack 划分与安装规范」。

## 当前包（跨境电商 category）

| pack id | Gate | 斜杠 | 扩展 |
|---|---|---|---|
| `cross-border-ecommerce-research` | 1a 选品 | `/亚马逊选品` | 无 |
| `cross-border-ecommerce-finance` | 1b 业财 | `/跨境业财` | `user.profit_assumptions` · `user.connector_load_feed` |

两包**独立安装/卸载**；同一 category 下可并存多个已装 pack。

## 新增包 checklist

1. `../taxonomy.json` 登记 **category**（行业维度，不是 pack id）
2. 建 `samples/packs/{category}-{scenario}/pack.json`（**一 pack 一主场景**）
3. `skills/*/SKILL.md` 只编排核心算子
4. 有 `user.*` 或 `connector/` 的包 → 安装时需用户 **确认扩展**
5. `pytest backend/tests/test_user_packs_store.py`

**不要**在无 connector 需求的 pack 里放 `extensions/` — 避免选品类用户误授权本机代码。
