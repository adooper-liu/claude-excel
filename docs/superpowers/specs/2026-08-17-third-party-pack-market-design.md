# 三方 Pack 市场框架（本地导入 + zip 导出）设计

状态：已确认 · 2026-08-17

## Context

产品定位：独立的 AI Excel 插件，本机后端只绑 `127.0.0.1`（loopback），无云。P3 路线里的「ERP 伙伴 Pack 市场」提前实施，但**先做本机框架**：作者端把 pack 目录打成 zip 分享，用户端导入/安装/卸载，UI 明确区分官方包与第三方包。

现状（已核实）：
- pack 只有官方源 `samples/packs/*`（`backend/user_packs_store.py:24`），运行时只把 `extensions/` + `connector/` 拷到 `~/.claude-excel-web/packs/{pid}/`（`RUNTIME_PACKS_DIR`，`user_extension_registry.py:14`）。
- **无任何导入/导出机制**（无 zip、无 `import_pack`）；「Pack 导出/分享 zip」在 `docs/user-packs.md` §7/§9 明确推迟。
- 安全模型已就绪：安装时 extensions 触发 consent 门（`install_pack` `consent_extensions`）；运行时 capability hash 变更即失效（`_pack_authorized`）；secrets 走 `extension-secrets.json`；主 key 永不进函数（`clean_env`）。第三方包直接复用这条链。

## 决策（已与用户确认）

1. **分发**：本地目录 + zip 导入（不做远程 registry/签名/托管）。
2. **范围**：消费端（导入/列表/安装/卸载）+ 作者端（`export_pack` 打 zip）。
3. **category**：官方包仍校验 `taxonomy.json`；第三方自由标签，UI 按标签分组。
4. **架构**：新增独立第三方源目录 `~/.claude-excel-web/packs-imported/`，与运行时目录分离。

## 架构

| 目录 | 角色 | 读写 |
|---|---|---|
| `samples/packs/` | 官方源 | 只读 |
| `~/.claude-excel-web/packs-imported/`（新增 `IMPORTED_PACKS_DIR`） | 第三方源（目录导入 / zip 解包落点） | 可读写 |
| `~/.claude-excel-web/packs/`（`RUNTIME_PACKS_DIR`） | 已装运行时（extensions/connector），**不改** | 只写 |

为什么独立目录：`_scan_extension_dirs` 扫描 `RUNTIME_PACKS_DIR/*/extensions/*/manifest.json`（`user_extension_registry.py:105-122`），把「已导入未安装」的包放进去会被 `list_extensions` 误注册成工具——**必须**与运行时目录分离。

数据流：
```
作者端：pack 目录 → export_pack → <id>-<version>.zip
用户端：zip → import_pack_zip（zip-slip 防护 + 校验）→ packs-imported/{id}/
     → list_packs 合并官方+第三方（tag source）→ UI 第三方徽标
     → install_pack（复用校验 + consent 信任门 + capability hash）→ 已装
     → uninstall_pack（按 installed record 的 skills 卸载，源可删）
```

## 数据模型

### catalog entry（`list_packs` 返回）增加字段

```jsonc
{
  "id": "...",
  "source": "official" | "third-party",   // 新增
  "category": "...",
  "categoryLabel": "...",                  // 官方: taxonomy label；第三方: pack.category 原样（空则 "第三方"）
  "title": "...", "description": "...", "version": "...", "gate": "...",
  "skills": [...], "knowledge": [...], "extensions": [...], "deps": {...},
  "installed": false
}
```

### `installed_packs.json` record 增加字段

```jsonc
{
  "id": "...",
  "source": "official" | "third-party",   // 新增
  "skills": ["skill-id-1", "..."],        // 新增：卸载时不再依赖源目录
  "installedAt": "...", "version": "...", "capabilityHash": "...", "consentedAt": "..."
}
```

**关键**：`uninstall_pack` 现读源目录 `_list_skills(PACKS_DIR / pid)` 拿 skill ids（`user_packs_store.py:326`）。第三方源可能被删，改为**从 installed record 读 `skills`**，卸载不再依赖源目录。

### pack.json schema

不变（第三方用同一 schema）。仅 `category` 校验分叉：官方 ∈ taxonomy；第三方自由字符串。

## 后端变更

### `backend/user_extension_registry.py`（或 `config_store.py`）
- 新增 `IMPORTED_PACKS_DIR = CONFIG_DIR / "packs-imported"`。

### `backend/user_packs_store.py`（核心）
- `_resolve_pack_dir(pid) -> tuple[Path, str]`：先官方后第三方，返回 `(dir, source)`；找不到抛 `ValueError("示例包不存在")`。`install_pack`/`uninstall_pack`/`list_packs` 用它。
- `list_packs()`：合并 `PACKS_DIR` 与 `IMPORTED_PACKS_DIR`；每 entry 带 `source`；`categoryLabel` 分叉（官方 taxonomy，第三方原样）。
- `import_pack_zip(zip_bytes: bytes) -> dict`：
  1. 大小/条目上限：总解压 ≤ 5MB、条目 ≤ 200。
  2. **zip-slip 防护**：拒绝绝对路径、`..` 前缀、`/` 开头、符号链接（`zipfile` 不产 symlink，但校验 `is_dir()` 前的路径段）。
  3. 根须有 `pack.json`；用 `_read_json` 解析；`id` 与目录名一致。
  4. **id 冲突**：与官方或已导入包同名 → `ValueError("已存在同名包: {id}，请改用 {vendor}-{pack} 命名")`。
  5. 解包到 `IMPORTED_PACKS_DIR/{id}/`（先清同名残留）。
  6. 返回 catalog entry（带 `source:"third-party"`）。
- `remove_imported_pack(pid)`：若已安装 → `ValueError("请先卸载")`；删 `IMPORTED_PACKS_DIR/{pid}`。
- `export_pack_zip(pid, source)`：把 `pack.json + skills/ + knowledge/ + extensions/ + connector/` 打成 `zipfile` 内存流，命名 `<id>-<version>.zip`。
- `install_pack(pid, *, consent_extensions)`：`pack_dir, source = _resolve_pack_dir(pid)`；**仅官方**校验 `category ∈ taxonomy`；其余校验（skills/extensions/knowledge 数、manifest 一致、信任门）不变；installed record 写入 `source` + `skills`。
- `uninstall_pack(pid)`：从 installed record 读 `skills` 逐个 `delete_skill`；`rmtree(RUNTIME_PACKS_DIR/pid)`；移除 record。

### `backend/server.py`
- `POST /api/user-skills/packs/import`：`require_loopback`；multipart 上传 zip（FastAPI `UploadFile`）；`import_pack_zip` → 返回 `{"pack": entry}`；`ValueError → 400`。
- `DELETE /api/user-skills/packs/imported/{id}`：`require_loopback`；`remove_imported_pack` → `{"pack": {"id": pid}}`；`ValueError → 400`。
- `GET /api/user-skills/packs/{id}/export`：`require_loopback`；`export_pack_zip` → `Response(content=zip_bytes, media_type="application/zip", headers={"Content-Disposition": ...})`。
- `GET /api/user-skills/packs`：返回合并目录（含 `source`）。

## 前端变更

### `addin/src/services/user-skills.ts`
- `Pack` 类型加 `source: "official" | "third-party"`。
- 新增 `importPackZip(file: File)`（FormData → POST import）、`removeImportedPack(id)`、`exportPack(id)`（触发下载）。

### `addin/src/taskpane/components/PackMenu.tsx`
- 头部加「导入 Pack (zip)」按钮（隐藏 file input）→ `importPackZip` → 成功后 `onChanged` 刷新。
- 第三方卡片（`p.source === "third-party"`）加「第三方」徽标；显示「删除来源」按钮（`removeImportedPack`），未安装时可删。
- 每张 pack 卡片加「导出 zip」按钮（作者端，`exportPack`）。

## 安全

- **zip-slip 防护** + 大小/条目上限（见上）。
- **id 冲突拒绝**（防覆盖官方包）。
- **信任边界**：导入 = 用户主动行为；含 extensions 的第三方包安装仍走 consent + capability hash；运行时 hash 变更即失效；主 key 永不进函数。**无新增信任面**。
- 第三方徽标 = provenance（来源可辨）。

## 明确不做（本轮）

- 远程 registry / 包签名 / 托管 / CDN。
- `minCoreVersion` 强校验。
- 卸载时清理 `extension-secrets.json`（现行为不变）。
- 官方源写入（`samples/packs` 仍只读）。

## 测试

### 后端 `backend/tests/test_user_packs_store.py`
- `import_pack_zip`：合法 zip → 落到 `packs-imported/{id}`；缺 `pack.json`；zip-slip 条目（`../x`、绝对路径）拒绝；超限拒绝；id 冲突拒绝。
- `list_packs` 合并官方+第三方，`source` 标记正确，`categoryLabel` 分叉正确。
- 从第三方源 `install_pack`（含 extensions 走 consent）；卸载按 record.skills 删（模拟源已删仍可卸）。
- `export_pack_zip` → `import_pack_zip` 回环。
- `remove_imported_pack`：未装可删、已装拒绝。

### 前端
- 无组件测试框架；`npm run typecheck` + `npm run test:unit` + `npm run build` 不回归。

## 验证（端到端）

1. `cd backend && python -m pytest tests/test_user_packs_store.py tests/test_user_skills_store.py -q`。
2. `cd backend && python -m pytest tests -q`（全量，pytest-asyncio 已入 `requirements-dev.txt`）。
3. `cd addin && npm run typecheck && npm run test:unit && npm run build`。
4. 手动：作者 `export_pack` 一个 zip → 任务窗格「导入 Pack」上传 → 列表出现第三方徽标 → 安装（含 extensions 弹 consent）→ `/` 列表可用 → 卸载 → 删除来源。
