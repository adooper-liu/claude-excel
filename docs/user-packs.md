# 场景包 Pack（P0，已定）

Pack 是**组织层**，不是新机制：把已有的 Skill、知识、recipe 依赖声明**装箱**，按 **category** 分组展示与一键安装。**不改变**核心算力边界，**不引入**可执行代码（P0 无 `user.*`）。

---

## 1. 三层边界（写格只有一条路）

| 层 | 是什么 | 典型位置 | 写 Excel |
|---|---|---|---|
| **A. 核心算力** | Office JS 通用算子 | `addin/skills/core` + `skill-handlers.ts` | ✅ **唯一合法写格通道** |
| **B. 核心数据** | 站点 DOM / project 列映射 | `backend/site_recipes/`、`recipe/hosts/` | ❌ 仅配置 |
| **C. 用户扩展** | Pack 四件套 | `samples/packs/` → `~/.claude-excel-web/` | ❌ 全部不写格 |

**C 的四件套：**

| 组件 | 职责 | P0 |
|---|---|---|
| **Skill**（`SKILL.md`） | 编排步骤、口径选项；**只调用** `skill-create-guide.ts` 里的核心算子 | ✅ |
| **Knowledge**（`.md`） | 方法论附录；知栏索引 / `search_knowledge` | ✅（安装后提示用户知栏上传或后续自动 ingest） |
| **Recipe deps** | 声明依赖 `amazon.com` 等**核心数据**，不复制 SOP | ✅ `pack.json` 的 `deps.recipes` |
| **Extensions**（`user.*`） | 本机 Python 计算，返回小 JSON | ✅ P1，见 [user-extensions-security.md](user-extensions-security.md) |
| **Connector**（Pack 内） | 从 CSV fixture 或 ERP OpenAPI 拉同构表进临时 sheet | 📄 Phase 1 CSV / Phase 2 ERP，见 pack 内 `connector/` |

**写格路径（强制）：**

```
用户 / Skill 编排 → 核心算子（reshape_table 等）→ Office JS → Excel
```

禁止：Skill 直接写格、`user.*` 写格、Python openpyxl、把行业函数注册进 `HANDLED_TOOLS`。

---

## 2. 目录布局

### 仓库（官方示例）

```
samples/
  taxonomy.json                          # category 单一真相
  industry-deconstruct-appendix.md       # 跨场景附录（可迁入 pack/knowledge）
  packs/
    cross-border-ecommerce/
      pack.json
      skills/amazon-research/SKILL.md
      knowledge/serp-appendix.md
      connector/                           # L3：feeds schema + csv_local / erp_* 实现
        feeds/*.schema.json
        implementations/
  skills/                                # 遗留：单 skill 安装（install-sample），新包请放 packs/
```

### 本机（用户安装后）

```
~/.claude-excel-web/
  skills/{skill-id}/SKILL.md             # install_pack → install_skill
  knowledge/                             # 用户知栏 / RAG
  fetch-recipes/                         # 用户取数 recipe
  installed_packs.json                   # 已装 pack 记录（P0 只装不卸）
  extension-secrets.json                 # P1：扩展密钥，不进 pack
```

---

## 3. `taxonomy.json`

```json
{
  "categories": [
    { "id": "cross-border-ecommerce", "label": "跨境电商" },
    { "id": "cross-border-logistics", "label": "跨境物流" },
    { "id": "hr", "label": "人力资源" },
    { "id": "finance", "label": "财务" }
  ]
}
```

新增场景：先在此登记 `id` + `label`，再建 `samples/packs/{id}/`。

---

## 4. `pack.json` schema

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 与目录名一致 |
| `category` | ✅ | 须在 `taxonomy.json` 的 `categories[].id` 中 |
| `title` | ✅ | UI 展示名 |
| `version` | 推荐 |  semver 字符串；P0 不 enforce |
| `description` | 可选 | 一句话 |
| `skills` | ✅ | 技能 id 列表，对应 `skills/{id}/SKILL.md` |
| `knowledge` | 可选 | 文件名列表，对应 `knowledge/` |
| `deps.recipes` | 可选 | 依赖的核心 host key，如 `["amazon.com"]` — **声明用**，引擎仍读仓库 `site_recipes` / `recipe/hosts` |

示例见 `samples/packs/cross-border-ecommerce/pack.json`。

**Skill 依赖核心数据的既有模式**：样例 SKILL 可写「列映射对齐 `recipe/hosts/amazon.com.yml`」— 这是**引用仓库核心数据**，不是把口径写进 Skill 可执行层。

---

## 5. 后端 API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/user-skills/packs` | 列 `samples/packs/*` + category + 是否已装 |
| POST | `/api/user-skills/install-pack` | `{"packId":"cross-border-ecommerce"}` |
| POST | `/api/user-skills/install-sample` | 遗留：装 `samples/skills/{id}` 单 skill |

实现：`backend/user_packs_store.py`（`install_pack` 循环 `install_skill`；失败 rollback）。

---

## 6. 与核心的混线禁令（Pack 也遵守）

| 禁止 | 原因 |
|---|---|
| 在 `pack/skills` 里发明工具名 | Skill 只能编排已有算子 |
| 把 SERP/利润/VOC **阈值**写进 `site_recipes` | 那是 B 层 DOM/列映射，不是 SOP |
| 把 Pack 内容编译进 `builtin-skills.ts` | 行业不进核心 |
| Pack 内 ERP auth/字段映射写进 `addin/skills/core` 或 `backend/` 核心 | 只许在 `pack/connector/` |
| Pack 内放 `.py` handler 不经 `user.*` 信任门 | 可执行代码走 P1 + 信任门 |

---

## 7. P0 明确不做

- `user.*` 本地函数（P1）
- Pack 导出 / 分享 zip
- `minCoreVersion` 强校验
- `installed_packs.json` 卸载 API
- 安装时自动 copy knowledge（当前：装 skill + 记录；知识走知栏，与现有 RAG 一致）

---

## 8. 新增官方 Pack  checklist

1. 在 `samples/taxonomy.json` 加 category（若新场景）
2. 建 `samples/packs/{id}/pack.json` + `skills/` + 可选 `knowledge/`
3. SKILL 正文只编排 `operator-catalog` 里的算子
4. `pytest backend/tests/test_user_packs_store.py`
5. 任务窗格按 category 展示（`GET /api/user-skills/packs`）

---

## 9. 实施阶段对照

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P0** | Pack + taxonomy + install-pack + UI 分组 | ✅ 已落地 |
| **P1** | `user.*` + 信任门 + `extension-secrets.json` | ✅ 已落地 |
| **P1b** | Gate 1b 业财闭环（CSV connector + 对账 Skill + 审计） | 📄 见 [gate-1b-finance-closed-loop.md](tasks/gate-1b-finance-closed-loop.md) |
| **P2** | Pack v1.1 ERP connector（积加/领星二选一）+ 导出 + category 增强 | 待定 |
| **P3** | minCoreVersion enforce、卸载、ERP 伙伴 Pack 市场 | 待定 |
