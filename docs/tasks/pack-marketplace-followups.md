# 三方 Pack 市场 — 待处理项

状态：待处理 · 2026-08-17 · 来源：三方 Pack 市场 final review 记录（已 merged 970607b）

三个待处理项均来自三方市场功能的最终审查，非阻塞，但建议后续处理。

## 1. consent 门旁路

- **位置**：`addin/src/taskpane/components/App.tsx` `handleInstallPack` 无条件传 `consentExtensions: true`
- **问题**：后端信任门（`install_pack` 的 `consent_extensions` 检查）被绕过；PackMenu 的 consent 弹窗是唯一闸门。对含 `user.*` 的第三方 pack，需确认这是否符合预期（信任链应双重把关）。
- **待办**：确认预期行为 → 要么前端仅在弹窗确认后才传 true，要么明确「UI 弹窗即唯一闸门」并写进 `docs/user-extensions-security.md`。

## 2. `server.py:426` 超限上传返回 500 而非 400

- **位置**：`backend/server.py` `api_import_pack`
- **问题**：`raise ValueError("zip 超过 5MB 上限")` 位于 try/except 块外，超大 zip 上传返回 HTTP 500 "Internal Server Error"，而非 400 + 正确错误消息；前端 `importPackZip` 会显示 "Internal Server Error"。
- **待办**：把该 raise 移进 try 块（或单独包一层），使其走 `ValueError → HTTPException(400)`。

## 3. `_safe_zip_name` 未拒盘符路径

- **位置**：`backend/user_packs_store.py` `_safe_zip_name`
- **问题**：`C:/evil` 形式的 zip 条目未被拒绝；`zipfile.extractall` 会因冒号非法目录名抛 OSError（不会穿越），但可能产生 500。Windows 下盘符限定名应显式拒绝。
- **待办**：在 `_safe_zip_name` 拒绝 `^[A-Za-z]:` 前缀条目。
