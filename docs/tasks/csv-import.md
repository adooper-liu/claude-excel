# 任务：导入 CSV 入口（connector 接真实业务数据）

> Claude Code × Cursor 唯一交接载体。聊天只传文件名 + 分支名。

- **分支**：`feat/csv-import`
- **状态**：`design`
- **主责（当前阶段）**：Claude Code（design）→ Cursor（coding）

## 目标

任务窗格加一个「导入 CSV」入口：用户点按钮选文件（订单 + 广告两个 CSV），connector 自动编码检测 → 列映射 → 写临时表 → 跑 `/跨境业财` recipe。**用户不需要知道 `~/.claude-excel-web` 路径、不需要手动改名/覆盖 fixture。**

## 边界 / 不做

- **写格仍唯一走核心算子**：connector 只解析返回 JSON，写临时表走 `write_to_sheet` / `ensure_table`。
- **列映射留在 Pack（L3）**：`ALIAS_LOOKUP` 不动，仍在 `connector-csv-local/handler.py`，核心不认识平台列名。
- **编码检测是通用能力**（UTF-8-sig → GBK → Latin1），不进核心业务逻辑。
- **不做**：文件多选批量、ERP API 直连（Phase 2）、超大文件流式分块（记已知限制）。

## 验收

- [ ] 后端 `pytest backend/tests` 全绿（含 GBK 编码检测测试）
- [ ] 前端 `npm run test:unit` + `npm run typecheck` 全绿
- [ ] 任务窗格「导入 CSV」按钮：选订单 CSV + 广告 CSV → 自动编码检测 → 写 `Pack_订单` / `Pack_广告`
- [ ] 导入后发 `/跨境业财` → recipe 在已导入的表上跑（**不重新读 fixture**）
- [ ] GBK 编码中文列名 CSV 能正确识别（不崩、不乱码）

## 方案

### 1. 编码检测（真新能力，connector handler 内）

`connector-csv-local/handler.py` 现在只有 `raw_bytes.decode("utf-8-sig")`。新增：

```python
def _decode_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "gbk", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ValueError("无法识别编码")
```

`load_feed` 改用 `_decode_bytes(raw_bytes)`。这是通用能力，不涉及平台字段，放 connector 内即可。

### 2. 导入源：`user.connector_load_feed` 增 `content` 参数

现有 `main()` 只从 stdin 读 `{feed, packId}`，`load_feed` 硬读 fixture 文件。改造：

- `load_feed(pack_id, feed, content=None)`：
  - `content` 非空 → 直接 `_decode_bytes(content.encode("utf-8"))` 或按需，跳过文件读取
  - `content` 空 → 走原 fixture 路径（录屏/pytest 不变）
- `main()` 解析 `content` 字段透传

这样 fixture 路径（demo/pytest）和导入路径（真实数据）共用同一套列映射/归一逻辑，**不复制**。

### 3. 前端：file picker + 写临时表

复用 `ChatInput.tsx` 的 `FileReader` 模式（`reader.readAsText(file)` → 拿文本内容）。

- 在 finance Pack 卡片（`ChatPanel.tsx`）加「导入 CSV」按钮，或 `/跨境业财` 入口旁。
- 两个文件：`orders.csv`（订单）+ `ads.csv`（广告），各一个 `<input type="file" accept=".csv">`。
- 读文件 → `fetch POST /api/user-fn/user.connector_load_feed`，body `{params: {feed, packId, content}}`。
- 拿到 `{headers, rows}` → 走核心 `write_to_sheet` / `ensure_table` 写 `Pack_订单` / `Pack_广告`。

### 4. recipe 改造：`finance-run.ts` 跳过已存在的表

`runFinanceIntent` 现在无条件 `loadConnectorFeed` 读 fixture。改为：

- 先 `getSheetNames()` 检查 `Pack_订单` / `Pack_广告` 是否已存在。
- 已存在（用户导入过）→ 跳过 connector load，直接 `ensure_table` → `reconcile` → … → audit。
- 不存在 → 走原 fixture load（demo 路径不变）。

### 5. 已知限制（不挡本任务，记 note）

`user.*` 执行有 `MAX_STDOUT_BYTES = 65536` 上限。超大 CSV（数千行）解析返回 JSON 会超 64KB 被截断。真实卖家导出通常几百行，MVP 够用；超大文件流式分块留 Phase 2。

## Review notes

（待 coding 后填）

## 进度 log

| 日期 | 阶段 | 负责 | commit | 说明 |
|---|---|---|---|---|
| 2026-08-16 | design | Claude Code | `—` | 初稿 brief（编码检测 + content 参数 + file picker + recipe 跳过 fixture） |
