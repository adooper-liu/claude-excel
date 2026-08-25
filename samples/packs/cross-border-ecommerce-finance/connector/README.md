# Pack connector 抽象（L3 only）

> **铁律**：任何 ERP（积加 / 领星 / 店小秘 / 马帮）的 auth、字段映射、分页、token 刷新**只许在本目录**实现。  
> 核心底座只认「HTTP GET + JSON 扁平化 + 写临时 sheet」，不出现 ERP 品牌名。

## 数据流（水电气隐喻）

```
平台 (Amazon/…) → ERP 水厂 (清洗/鉴权) → [connector 拉数] → 本机 Excel 临时表 → Skill recipe → 新结果 sheet
```

SheetWise **不重建水厂**；connector 从 ERP OpenAPI 或 Phase 1 的 CSV fixture **取同构表**。

## 输出契约（recipe 只读这一层）

下游 Skill（对账 / 假设 / 透视）**只依赖** `feeds/*.schema.json` 定义的 canonical 列名，不依赖数据来源。

| feed id | 临时 sheet 名 | 用途 |
|---|---|---|
| `orders` | `Pack_订单` | 对账左表 / 利润主表 |
| `ads` | `Pack_广告` | 对账右表 / TACoS |
| `inventory` | `Pack_库存` | 可选，库存差异 |

列定义见同目录 `feeds/orders.schema.json` 等。

## 实现体（可替换，接口不变）

| 阶段 | 实现 | 位置 |
|---|---|---|
| **Phase 1 / Gate 1b** | `csv_local` | `implementations/csv_local/` — 读 `fixtures/` 脱敏 CSV，写同构列 |
| **Phase 2 v1.1** | `erp_jijia` 或 `erp_lingxing`（二选一） | `implementations/erp_*/` — `user.*` 子进程 + `extension-secrets.json` |

Phase 1 **不接** ERP OAuth；Gate 1b 用 CSV 实现体验证「管道 + recipe」。

## 密钥

- ERP `appId` / `appSecret`：**不进 LLM**；走 `extension-secrets.json` + `user.*`（与模型 key 同类信任门）。
- 核心 `web_fetch` 可用于 Pack 内 **generic GET**（若 ERP 提供简单 REST），但 **不得**把 ERP 名写进 `addin/skills/core`。

## 安装

`pack.json` 未来可增：

```json
"connectors": ["csv_local"],
"connectorDefault": "csv_local"
```

P1 已支持 `extensions[]`；connector 模块与 `extensions/` 并列，**不进 `skills/`**。
