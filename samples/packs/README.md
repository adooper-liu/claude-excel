# 官方场景包（Pack）

按 **category** 分组的示例 bundle，用户通过 `POST /api/user-skills/install-pack` 或任务窗格一键安装。

完整规则见 [docs/user-packs.md](../../docs/user-packs.md)。

## 当前包

| 目录 | category | 技能 |
|---|---|---|
| `cross-border-ecommerce/` | 跨境电商 | `/亚马逊选品` |

## 新增包

1. 在 `../taxonomy.json` 登记 category  
2. 复制 `cross-border-ecommerce/` 改 `pack.json`  
3. `skills/*/SKILL.md` 只编排核心算子（见 `addin/src/services/skill-create-guide.ts`）  
4. 跑 `pytest backend/tests/test_user_packs_store.py`

**不要**在此目录放 Python handler — `user.*` 属于 P1，见 `docs/user-extensions-security.md`。
