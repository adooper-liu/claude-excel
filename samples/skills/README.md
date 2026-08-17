# 遗留：单 skill 示例目录

新官方示例请放在 **`samples/packs/{pack-id}/skills/`**，见 [docs/user-packs.md](../../docs/user-packs.md) §10。

本目录仍供 **`POST /api/user-skills/install-sample`** 使用，当前示例：`{"id":"product-info-search"}`。`amazon-research` 已由 pack `cross-border-ecommerce-research` 提供（`install-pack`），install-sample 找不到时会回退到 pack 副本。

## 安装方式（优先用 Pack）

| 方式 | 说明 |
|---|---|
| **install-pack** | `{"packId":"cross-border-ecommerce-research"}` — Gate 1a 选品 |
| **install-pack** | `{"packId":"cross-border-ecommerce-finance"}` — Gate 1b 业财 |
| install-sample | `{"id":"product-info-search"}` — 仅装单个 skill（遗留）；`amazon-research` 回退 pack |
| 手动复制 | 到 `~/.claude-excel-web/skills/` |
| `/安装` 粘贴 | SKILL.md 全文 |
