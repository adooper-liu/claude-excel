# 项目文档索引

| 文档 | 内容 | 状态 |
|---|---|---|
| [../CLAUDE.md](../CLAUDE.md) | 产品定位、三层边界、开发纪律（主入口） | 已定 |
| [product-vision.md](product-vision.md) | **架构 + 商业价值 + 路线图** 总览 | 随时更新 |
| [user-packs.md](user-packs.md) | **P0** 场景包（Pack）：目录、schema、API、与核心的关系 | 已定，代码已落地 |
| [user-extensions-security.md](user-extensions-security.md) | **P1** `user.*` 本地函数：威胁模型、子进程、信任门 | 已落地 |

改代码前先看 **CLAUDE.md** 的「底层 vs 用户侧」边界；加 Pack 看 **user-packs.md**；动 `user.*` 必须先过 **user-extensions-security.md** review。
