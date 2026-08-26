# 导出 / 导入备份（Export / Import Backup）设计

> 状态：已定（2026-08-26）。消费者：实现者（Codex 按此实施）、评审者（Claude code-review 对照核对）、后续维护者。
> 目标：把「换机迁移 = 手工拷 `~/.claude-excel-web/`」升级为产品内一键导出/导入，为商用铺路。

## 1. 背景与目标

用户换机台迁移时，目前需要手工拷贝 `~/.claude-excel-web/` 整个目录，还要纠结 config.json（含 API Key）怎么走安全通道。目标是把迁移变成产品功能：**设置里一键导出 → 新机导入 → 重填 Key**。

已确认的关键决策：

- **API Key 不进备份**（Q1）——备份只含 provider 配置骨架，Key 置空，新机重填。
- **恢复后扩展重新同意**（Q2）——备份里的 consent 记录只当预览参考，恢复时不信任；含扩展的包导入后走现有 consent 流程重新确认，防伪造备份跳过信任门。
- **实现走结构化 manifest 打包**（方案 B），非整目录 zip。

## 2. 范围

**含**（随备份走）：已装技能、知识库源文档、第三方导入的场景包、场景包安装记录（参考）、提示词模板、取数 recipe、provider 配置骨架。

**不含**：

- config.json 的 API Key（置空）
- `knowledge/index.sqlite`（本地向量索引，恢复后重建）
- `fetch-data/`（网页抓取缓存，可重取）
- `.staging` 等临时目录
- 官方场景包源码（随应用自带，恢复时从 `samples/packs/` 重装）

**非目标（YAGNI，v1 不做）**：

- 增量 / 差异备份
- 定时自动备份
- 加密备份包（v1 备份不含密钥，无需加密；将来若支持带密钥备份再引入）
- 云端备份
- 分用户多 profile

## 3. 备份格式（.zip）

文件名：`sheetwise-backup-<YYYY-MM-DD>.zip`。

```text
sheetwise-backup-<date>.zip
├── manifest.json
├── config/provider-skeleton.json
├── skills/<skill-id>/SKILL.md
├── knowledge/sources/<doc>.*
├── packs/<pack-id>/…            （仅第三方导入的包：packs-imported/ 源目录）
├── installed-packs.json
├── templates.json
└── fetch-recipes/<host>.json
```

### manifest.json schema

```json
{
  "format": "sheetwise-backup",
  "version": 1,
  "createdAt": "2026-08-25T00:00:00Z",
  "appVersion": "3.0.0",
  "contents": ["skills", "knowledge", "packs", "installed-packs", "templates", "fetch-recipes", "config"]
}
```

`version` 用于向后兼容：导入时若 `version > 1` 拒绝（「备份来自更新版本」）；`format` 不匹配拒绝。

## 4. 导出（Export）

### 4.1 端点

`GET /api/backup/export` → 200，`Content-Type: application/zip`，`Content-Disposition: attachment; filename="sheetwise-backup-<date>.zip"`。

### 4.2 收集逻辑

| 数据 | 来源 | 处理 |
| --- | --- | --- |
| config 骨架 | `config_store.get_config()` / providers | `apiKey` 全部置空；只保留 provider 名、baseUrl、model、smallFastModel、activeProvider |
| skills | `CONFIG_DIR/skills/*/SKILL.md` | 逐目录写入 `skills/<id>/SKILL.md` |
| knowledge sources | `CONFIG_DIR/knowledge/sources/*` | 只写允许扩展名（.md/.txt/.csv）；不写 index.sqlite |
| 第三方 packs | `CONFIG_DIR/packs-imported/*` | 整目录写入 `packs/<pid>/…`（跳过 `__pycache__`） |
| installed-packs | `CONFIG_DIR/installed_packs.json` | 原样写入，标注「参考」 |
| templates | `CONFIG_DIR/templates.json` | 原样写入 |
| fetch-recipes | `CONFIG_DIR/fetch-recipes/*.json` | 逐文件写入 |

### 4.3 上限

- `MAX_BACKUP_BYTES = 50 * 1024 * 1024`（50MB）
- `MAX_BACKUP_ENTRIES = 2000`

导出时超过上限直接报错（不生成 zip），提示用户先清理知识库/取数数据。

### 4.4 排除清单（实现时明确过滤）

`index.sqlite`、`fetch-data/`、`.staging`、`__pycache__`、config 里的 apiKey 字段。

## 5. 导入（Import）

两步端点，预览与应用分离。

### 5.1 `POST /api/backup/import/preview`

multipart 上传 zip → 校验 → 返回预览，**不写任何数据**。

校验（复用 `user_packs_store.py` 的模式，可抽公共 helper）：

- zip 字节 ≤ `MAX_BACKUP_BYTES`；条目 ≤ `MAX_BACKUP_ENTRIES`
- 逐条 `_safe_zip_name` 路径穿越检查
- 根目录存在 `manifest.json`，`format == "sheetwise-backup"`，`version <= 1`

响应：

```json
{
  "ok": true,
  "manifest": { "format": "sheetwise-backup", "version": 1, "createdAt": "…", "appVersion": "…" },
  "contents": {
    "skills": ["skill-id", "…"],
    "knowledge": ["doc.md", "…"],
    "packs": [ { "id": "…", "source": "official|third-party", "title": "…", "hasExtensions": true } ],
    "config": { "providers": ["deepseek", "qwen", "…"], "activeProvider": "deepseek" },
    "templates": true,
    "recipes": ["host1", "…"]
  },
  "needsConsent": true
}
```

`needsConsent` = 备份中**任一包的内容**含非空 `extensions/` 目录（从备份实际内容判定，不读 installed-packs.json 的 consent）。

### 5.2 `POST /api/backup/import/apply`

multipart 上传 zip + 表单 `consentExtensions: bool` → 逐类恢复。

**恢复语义：合并覆盖**。备份里有的覆盖当前同名项；当前多出来的保留。v1 不做「清空式还原」。

执行顺序（每类独立 staging，失败整批回滚）：

1. **解包到 staging**（`.staging-backup`），全量校验同 preview
2. **校验 manifest**
3. **技能**：读 `skills/<id>/SKILL.md` → 走 `install_skill`（校验 frontmatter、MAX_SKILLS 上限）。任一失败 → 回滚本次已装技能。
4. **场景包**：包清单来自备份的 `installed-packs.json` 记录（只取其 id 与 source 作清单，不信任其 consent）；包内容来自 samples（official）或备份 `packs/`（third-party）：
   - 官方：从 `samples/packs/<pid>/` `install_pack`（含扩展需 `consent_extensions`）
   - 第三方：先把 `packs/<pid>/` 从 staging 恢复到 `packs-imported/<pid>/`，再 `install_pack`
   - 同名已装：先 `uninstall_pack` 再恢复（覆盖语义）
   - 任一失败 → 回滚本次已装技能与包
5. **知识源**：复制 `knowledge/sources/*` 到目标 → 触发重索引（复用知识库 ingest / 重建逻辑；不备份 index.sqlite）
6. **config 骨架**：写 provider 配置（Key 空）；**不覆盖**当前已有的非空 Key
7. **templates / fetch-recipes**：直拷覆盖
8. 清理 staging，返回摘要

响应：

```json
{
  "ok": true,
  "restored": { "skills": ["…"], "knowledge": ["…"], "packs": ["…"], "config": true, "templates": true, "recipes": ["…"] },
  "consented": ["pack-id"] 
}
```

### 5.3 信任门（强制）

- 备份里的 `installed-packs.json` **只用于预览**（列包名、来源），恢复时**不读取其 consent**。
- 恢复后含扩展的包一律处于「已安装但扩展未同意」或由 apply 的 `consentExtensions` 显式同意。
- 扩展的能力哈希（`pack_capability_hash`）在恢复时重新计算，不用备份值。

## 6. UI（SettingsPanel 新增「备份与迁移」节）

- **导出备份** 按钮：调 `/api/backup/export`，浏览器/加载项下载 zip。
- **导入备份** 按钮：文件选择 zip → 调 `/api/backup/import/preview` → 展示预览：
  - 技能 / 知识源 / 包 / 配置骨架清单
  - 若 `needsConsent`：红色提示「此备份含本机扩展（user.*），导入后需要信任」+ 勾选「我信任这些扩展」
  - 提示「备份不含 API Key，导入后请在设置中重新填写」
  - **确认** → 调 `/api/backup/import/apply` → 展示结果
- 错误（坏 zip、超限、版本不兼容）在面板内展示后端返回的中文错误。

## 7. 安全设计

1. **密钥不出备份**：导出时 config 只写骨架；导入时不写非空 Key、不覆盖现有 Key。
2. **zip 校验**：大小/条目/路径遍历三重检查，复用 `user_packs_store` 的 `_safe_zip_name` 与上限模式。
3. **信任门不可伪造**：consent 不随备份生效，恢复重走同意；能力哈希恢复时重算。
4. **staging + 原子回滚**：任何一类失败，整批回滚本次导入，不残留半套数据。
5. 恢复的技能/包仍受各自上限约束（MAX_SKILLS / MAX_PACK_SKILLS 等）。

## 8. 测试计划

后端单测（沿用 `backend/tests/test_user_packs_store.py` 等模式，monkeypatch USERPROFILE/HOME）：

- **导出**：含技能/知识源/第三方包/模板/recipe/配置骨架；不含 apiKey、index.sqlite、fetch-data；manifest 正确；超限报错。
- **导入 preview**：坏 zip（非 zip、超大小、超条目、路径穿越、缺 manifest、format 不符、version 过高）各自拒绝且不落盘。
- **导入 apply**：技能/知识/包/模板/recipe/config 骨架正确恢复；含扩展包未给 consent 时报错、给了才恢复；同名已装包先卸载再覆盖；config 不覆盖现有 Key；失败回滚后不留半套。
- 现有测试不回归（packs、skills、knowledge、templates store 各自测试保持绿）。

## 9. 文档更新

- `docs/migration.md`：步骤 3「迁用户数据」改为——新机导入前先在设置里导出备份；「拷贝 `~/.claude-excel-web/`」改为「设置 → 导出备份 → 新机导入 → 重填 Key」；`config.json` 安全通道说明删除（备份不含 Key）。
- `docs/document-usage.md`：migration.md 行描述同步微调（如需要）。

## 10. 需要动到的文件（预估）

- 新增 `backend/backup_store.py`（导出/导入核心逻辑，抽公共 zip 校验）
- `backend/server.py`（两个新端点）
- `backend/user_packs_store.py`（如需抽公共 `_safe_zip_name` / 上限常量）
- `addin/src/taskpane/components/SettingsPanel.tsx`（UI 节）
- `addin/src/services/`（前端调用 helper，如需要）
- `backend/tests/test_backup_store.py`（新增）
- `docs/migration.md`（更新）
