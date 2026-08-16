# 任务：P1 UX 收尾（pack 卸载 + 重新授权引导 + 未授权标记）

> Claude Code × Cursor 唯一交接载体。聊天只传文件名 + 分支名。

- **分支**：`fix/p1-ux`
- **状态**：`coding`
- **主责（当前阶段）**：Claude Code（实现）

## 目标

补 P1 三个 UX 缺口：① pack 卸载（清 extensions + 工具缓存失效）；② 本机函数 `NOT_AUTHORIZED` 时前端引导重装；③ 未授权函数在工具描述里标「未授权」。

## 边界 / 不做

- 不碰核心锁步（`HANDLED_TOOLS` / `ADDIN_HANDLERS` / switch）。
- 卸载只清本 pack 装进去的东西：skills、`~/.claude-excel-web/packs/{id}/`、`installed_packs.json` 记录；不删用户 knowledge 或其它 pack。
- 不做 P3 完整卸载（minCoreVersion、ERP 伙伴市场）；本次只做最小 `uninstall_pack`。

## 验收

- [ ] 后端 `pytest backend/tests` 全绿（含 `test_uninstall_pack_*`）
- [ ] 前端 `npm run typecheck` 全绿
- [ ] 卸载后：skill 目录删、extensions 目录删、installed 记录删、`getAllTools` 缓存失效
- [ ] `authorized:false` 函数描述含「未授权」
- [ ] `NOT_AUTHORIZED` 触发重装提示

## 方案

1. 后端 `user_packs_store.uninstall_pack(pack_id)`：删 pack skills（复用 `delete_skill`）→ 删 `RUNTIME_PACKS_DIR/{id}` → 删 installed 记录；`server.py` 加 `DELETE /api/user-skills/packs/{pack_id}`（require_loopback）。
2. 前端 `user-skills.ts`：加 `uninstallPack()`；`fetchUserTools` 对 `authorized:false` 追加「（未授权）」。
3. 前端 `ChatPanel` 已装 pack 加「卸载」按钮；`App.onToolUse` 拦截 `NOT_AUTHORIZED` → 提示重装。
4. 测试 `test_user_packs_store.py` 加 `uninstall_pack` 用例。

## Review notes

（待评审）

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-16 | coding | Claude Code | `—` | 初稿 + 实现 |
