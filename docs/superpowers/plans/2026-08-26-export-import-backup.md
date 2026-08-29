---
status: done
---
# 导出 / 导入备份 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户在设置面板一键导出备份 zip、在新机导入恢复（技能/知识库/场景包/配置骨架/模板/取数 recipe），实现商用级换机迁移。

**Architecture:** 新增 `backend/backup_store.py` 承担导出/导入核心逻辑，复用现有各 store（skills/knowledge/packs/templates/fetch-recipes）做逐类校验与恢复；`server.py` 加三个薄端点；设置面板新增「备份与迁移」节。备份**不含 API Key**，扩展的 consent 不随备份生效、恢复后重新同意。

**Tech Stack:** Python 3 + FastAPI + zipfile + pytest（后端）；React + TypeScript（设置面板）；无新增依赖。

**Spec:** `docs/superpowers/specs/2026-08-26-export-import-backup-design.md`（本计划的所有约束来自该 spec，执行者两个都要读）

## Global Constraints

- **密钥不出备份**：config 只导出 provider 骨架，`apiKey` 永远不写入备份；导入时不写非空 Key、不覆盖现有 Key。
- **信任门不可伪造**：备份里的 `installed-packs.json` 只当清单参考，恢复时**不读取其 consent**；含扩展的包恢复走 `install_pack(consent_extensions=…)` 重新同意。
- **zip 校验**：字节 ≤ `MAX_BACKUP_BYTES`(50MB)、条目 ≤ `MAX_BACKUP_ENTRIES`(2000)、逐条路径穿越检查（复用 `user_packs_store._safe_zip_name`）、根目录必须有 `manifest.json`。
- **排除项**：`knowledge/index.sqlite`、`fetch-data/`、`.staging*`、`__pycache__`、config 里的 apiKey。
- **恢复语义：合并覆盖**（备份里有的覆盖同名；当前多出的保留），不做清空式还原。
- **上限继承**：技能受 `MAX_SKILLS`(40)、知识库受 `MAX_DOCS`(100)、单文件 2MB 等现有 store 上限约束。
- 官方场景包源码不进备份（随应用自带），恢复时从 `samples/packs/` 重装。
- manifest `version <= 1`；`format == "sheetwise-backup"`。
- 测试隔离：所有测试 `monkeypatch.setattr(store_module, "PATH_CONSTANT", tmp_path / …)`，沿用 `backend/tests/test_user_packs_store.py` 模式。

---

### Task 1: backup_store.py — 导出（export_backup + 配置骨架）

**Files:**
- Create: `backend/backup_store.py`
- Test: `backend/tests/test_backup_store.py`

**Interfaces:**
- Produces: `export_backup() -> bytes`（返回 zip 字节）、`BACKUP_FORMAT="sheetwise-backup"`、`BACKUP_VERSION=1`、`MAX_BACKUP_BYTES=50*1024*1024`、`MAX_BACKUP_ENTRIES=2000`。后续任务在同一个模块里加函数。

- [ ] **Step 1: 写失败的测试**

创建 `backend/tests/test_backup_store.py`：

```python
"""Backup store: export / import user data backup (no API keys, re-consent extensions)."""

import asyncio
import io
import json
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(ROOT / "backend"))

import backup_store  # noqa: E402
import config_store  # noqa: E402
import fetch_recipe  # noqa: E402
import knowledge_store  # noqa: E402
import templates_store  # noqa: E402
import user_extension_registry  # noqa: E402
import user_packs_store  # noqa: E402
import user_skills_store  # noqa: E402


def _make_zip(entries: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


def _patch_data_dirs(tmp_path, monkeypatch) -> None:
    """把所有用户数据路径指到 tmp_path 下（沿用 test_user_packs_store 的模式）。"""
    monkeypatch.setattr(config_store, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(config_store, "CONFIG_FILE", tmp_path / "config.json")
    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(knowledge_store, "KNOWLEDGE_DIR", tmp_path / "knowledge")
    monkeypatch.setattr(knowledge_store, "SOURCES_DIR", tmp_path / "knowledge" / "sources")
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(templates_store, "TEMPLATES_FILE", tmp_path / "templates.json")
    monkeypatch.setattr(fetch_recipe, "RECIPES_DIR", tmp_path / "fetch-recipes")


def test_export_contains_skills_and_config_skeleton(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    (tmp_path / "skills" / "my-skill").mkdir(parents=True)
    (tmp_path / "skills" / "my-skill" / "SKILL.md").write_text(
        "---\nname: my-skill\ndescription: 演示\nslash: 演示\n---\n# demo\n",
        encoding="utf-8",
    )
    (tmp_path / "fetch-recipes").mkdir()
    (tmp_path / "fetch-recipes" / "amazon.com.json").write_text(json.dumps({"host": "amazon.com"}), encoding="utf-8")
    monkeypatch.setattr(
        config_store,
        "_config",
        {
            "activeProvider": "deepseek",
            "providers": {"deepseek": {"apiKey": "sk-secret", "baseUrl": "https://api.deepseek.com/anthropic", "model": "m1", "smallFastModel": "m2"}},
        },
    )

    data = backup_store.export_backup()

    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    assert "manifest.json" in names
    assert "skills/my-skill/SKILL.md" in names
    assert "config/provider-skeleton.json" in names
    assert "fetch-recipes/amazon.com.json" in names
    manifest = json.loads(zf.read("manifest.json"))
    assert manifest["format"] == "sheetwise-backup"
    assert "config" in manifest["contents"]
    skeleton = json.loads(zf.read("config/provider-skeleton.json"))
    assert skeleton["providers"]["deepseek"]["baseUrl"] == "https://api.deepseek.com/anthropic"
    assert "apiKey" not in skeleton["providers"]["deepseek"]
    assert "sk-secret" not in data.decode("utf-8", errors="ignore")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_backup_store.py::test_export_contains_skills_and_config_skeleton -v`
Expected: FAIL / ERROR，`ModuleNotFoundError: No module named 'backup_store'`。

- [ ] **Step 3: 实现导出**

创建 `backend/backup_store.py`：

```python
"""backup_store.py — Export / import user data backup.

备份不含 API Key：config 只导出 provider 骨架（Key 置空）。恢复时扩展走信任门
（consent 不随备份生效，恢复后重新同意），防伪造备份跳过同意。
"""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config_store import CONFIG_DIR, get_config, save_config
from user_packs_store import _safe_zip_name, install_pack, uninstall_pack
from user_skills_store import delete_skill, install_skill

# 动态引用各 store 的路径常量（调用时取值），测试 monkeypatch store 模块即可隔离。
import fetch_recipe
import knowledge_store
import templates_store
import user_extension_registry
import user_packs_store
import user_skills_store

BACKUP_FORMAT = "sheetwise-backup"
BACKUP_VERSION = 1
MAX_BACKUP_BYTES = 50 * 1024 * 1024
MAX_BACKUP_ENTRIES = 2000

ALLOWED_KNOWLEDGE_EXT = {".md", ".markdown", ".txt", ".csv"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _config_skeleton() -> dict:
    cfg = get_config()
    providers = {}
    for pid, p in (cfg.get("providers") or {}).items():
        providers[pid] = {
            "baseUrl": str(p.get("baseUrl") or ""),
            "model": str(p.get("model") or ""),
            "smallFastModel": str(p.get("smallFastModel") or ""),
        }
    return {"activeProvider": str(cfg.get("activeProvider") or "deepseek"), "providers": providers}


def export_backup() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "createdAt": _now_iso(),
            "appVersion": "3.0.0",
            "contents": ["skills", "knowledge", "packs", "installed-packs", "templates", "fetch-recipes", "config"],
        }
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr("config/provider-skeleton.json", json.dumps(_config_skeleton(), ensure_ascii=False, indent=2))

        skills_dir = user_skills_store.SKILLS_DIR
        if skills_dir.is_dir():
            for md in sorted(skills_dir.glob("*/SKILL.md")):
                zf.write(md, "skills/" + md.parent.name + "/SKILL.md")

        sources = knowledge_store.SOURCES_DIR
        if sources.is_dir():
            for p in sorted(sources.iterdir()):
                if p.is_file() and p.suffix.lower() in ALLOWED_KNOWLEDGE_EXT:
                    zf.write(p, "knowledge/sources/" + p.name)

        imported = user_packs_store.IMPORTED_PACKS_DIR
        if imported.is_dir():
            for pid_dir in sorted(imported.iterdir()):
                if not pid_dir.is_dir() or pid_dir.name.startswith("."):
                    continue
                for p in sorted(pid_dir.rglob("*")):
                    if p.is_file() and "__pycache__" not in p.parts:
                        zf.write(p, "packs/" + pid_dir.name + "/" + p.relative_to(pid_dir).as_posix())

        inst = user_extension_registry.INSTALLED_PACKS_FILE
        if inst.is_file():
            zf.write(inst, "installed-packs.json")

        tpl = templates_store.TEMPLATES_FILE
        if tpl.is_file():
            zf.write(tpl, "templates.json")

        recipes = fetch_recipe.RECIPES_DIR
        if recipes.is_dir():
            for p in sorted(recipes.glob("*.json")):
                zf.write(p, "fetch-recipes/" + p.name)

    data = buf.getvalue()
    if len(data) > MAX_BACKUP_BYTES:
        raise ValueError("备份超过 50MB 上限，请先清理知识库或取数数据")
    return data
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_backup_store.py::test_export_contains_skills_and_config_skeleton -v`
Expected: PASS。

- [ ] **Step 5: 补排除项测试**

在 `test_backup_store.py` 追加：

```python
def test_export_excludes_index_and_fetch_data(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    (tmp_path / "knowledge" / "sources").mkdir(parents=True)
    (tmp_path / "knowledge" / "sources" / "doc.md").write_text("hello", encoding="utf-8")
    (tmp_path / "knowledge" / "index.sqlite").write_bytes(b"idx")
    (tmp_path / "fetch-data").mkdir()
    (tmp_path / "fetch-data" / "cache.bin").write_bytes(b"cache")
    (tmp_path / "skills").mkdir()
    (tmp_path / "skills" / "keep").mkdir()
    (tmp_path / "skills" / "keep" / "SKILL.md").write_text(
        "---\nname: keep\ndescription: 保留\nslash: 保留\n---\n# k\n", encoding="utf-8"
    )

    data = backup_store.export_backup()
    names = zipfile.ZipFile(io.BytesIO(data)).namelist()

    assert "knowledge/sources/doc.md" in names
    assert not any("index.sqlite" in n for n in names)
    assert not any("fetch-data" in n for n in names)
```

- [ ] **Step 6: 运行全部导出测试并提交**

Run: `cd backend && python -m pytest tests/test_backup_store.py -v`
Expected: 2 tests PASS。

```bash
git add backend/backup_store.py backend/tests/test_backup_store.py
git commit -m "feat(backup): 导出备份 zip（config 骨架无 Key、排除索引/缓存）"
```

---

### Task 2: backup_store.py — 校验与预览（preview_backup）

**Files:**
- Modify: `backend/backup_store.py`
- Test: `backend/tests/test_backup_store.py`

**Interfaces:**
- Produces: `_open_valid_zip(zip_bytes: bytes) -> zipfile.ZipFile`（校验并打开）、`_read_manifest(zf) -> dict`、`preview_backup(zip_bytes: bytes) -> dict`。
- Consumes: Task 1 的 `BACKUP_FORMAT`/`BACKUP_VERSION`/`MAX_BACKUP_BYTES`/`MAX_BACKUP_ENTRIES`、`user_packs_store._safe_zip_name`。

- [ ] **Step 1: 写失败的测试**

在 `test_backup_store.py` 追加：

```python
def _backup_zip(manifest=None, extra: dict | None = None) -> bytes:
    entries = {"manifest.json": json.dumps(manifest or {"format": "sheetwise-backup", "version": 1, "createdAt": "t", "contents": ["skills"]})}
    entries.update(extra or {})
    return _make_zip(entries)


def test_preview_backup_valid(tmp_path, monkeypatch):
    z = _backup_zip(extra={
        "skills/a/SKILL.md": "---\nname: a\ndescription: A\nslash: A\n---\n# a\n",
        "config/provider-skeleton.json": json.dumps({"activeProvider": "deepseek", "providers": {"deepseek": {"baseUrl": "u", "model": "m"}}}),
    })
    prev = backup_store.preview_backup(z)
    assert prev["ok"] is True
    assert prev["contents"]["skills"] == ["a"]
    assert prev["contents"]["config"]["providers"] == ["deepseek"]
    assert prev["needsConsent"] is False


def test_preview_rejects_bad_zip():
    with pytest.raises(ValueError, match="无法解析"):
        backup_store.preview_backup(b"not a zip")


def test_preview_rejects_missing_manifest():
    with pytest.raises(ValueError, match="manifest"):
        backup_store.preview_backup(_make_zip({"skills/a/SKILL.md": "x"}))


def test_preview_rejects_traversal():
    with pytest.raises(ValueError, match="非法路径"):
        backup_store.preview_backup(_backup_zip(extra={"../evil": "x"}))


def test_preview_rejects_newer_version():
    with pytest.raises(ValueError, match="更新版本"):
        backup_store.preview_backup(_backup_zip(manifest={"format": "sheetwise-backup", "version": 99, "contents": []}))


def test_preview_needs_consent_when_pack_has_extensions(tmp_path, monkeypatch):
    z = _backup_zip(extra={
        "installed-packs.json": json.dumps([{"id": "vendor-p", "source": "third-party"}]),
        "packs/vendor-p/pack.json": json.dumps({"id": "vendor-p", "skills": []}),
        "packs/vendor-p/extensions/demo/manifest.json": json.dumps({"name": "user.demo_fn"}),
    })
    prev = backup_store.preview_backup(z)
    assert prev["needsConsent"] is True
    assert any(p["id"] == "vendor-p" and p["hasExtensions"] for p in prev["contents"]["packs"])
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_backup_store.py -k preview -v`
Expected: FAIL，`AttributeError: module 'backup_store' has no attribute 'preview_backup'`。

- [ ] **Step 3: 实现校验与预览**

在 `backup_store.py` 末尾追加：

```python
def _open_valid_zip(zip_bytes: bytes) -> zipfile.ZipFile:
    if len(zip_bytes) > MAX_BACKUP_BYTES:
        raise ValueError("备份超过 50MB 上限")
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError("无法解析备份 zip") from exc
    infos = zf.infolist()
    if len(infos) > MAX_BACKUP_ENTRIES:
        raise ValueError(f"备份条目超过 {MAX_BACKUP_ENTRIES} 上限")
    if sum(i.file_size for i in infos) > MAX_BACKUP_BYTES:
        raise ValueError("备份解压超过 50MB 上限")
    for info in infos:
        if not _safe_zip_name(info.filename):
            raise ValueError("备份含非法路径: " + info.filename)
    if not any(info.filename == "manifest.json" and not info.is_dir() for info in infos):
        raise ValueError("备份缺少 manifest.json")
    return zf


def _read_manifest(zf: zipfile.ZipFile) -> dict:
    try:
        data = json.loads(zf.read("manifest.json").decode("utf-8"))
    except (KeyError, json.JSONDecodeError, OSError) as exc:
        raise ValueError("manifest.json 无法解析") from exc
    if not isinstance(data, dict) or data.get("format") != BACKUP_FORMAT:
        raise ValueError("不是 SheetWise 备份文件")
    version = int(data.get("version") or 0)
    if version > BACKUP_VERSION:
        raise ValueError("备份来自更新版本，请先升级应用再导入")
    return data


def _preview_packs(zf: zipfile.ZipFile) -> list[dict]:
    names = zf.namelist()
    out: list[dict] = []
    seen: set[str] = set()
    recs: list[dict] = []
    if "installed-packs.json" in names:
        try:
            data = json.loads(zf.read("installed-packs.json").decode("utf-8"))
            if isinstance(data, list):
                recs = [r for r in data if isinstance(r, dict)]
        except (json.JSONDecodeError, KeyError):
            pass
    for rec in recs:
        pid = str(rec.get("id") or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        source = str(rec.get("source") or "")
        if source == "official":
            pack_dir = user_packs_store.PACKS_DIR / pid
            has_ext = (pack_dir / "extensions").is_dir() and any((pack_dir / "extensions").iterdir())
            out.append({"id": pid, "source": "official", "title": str(rec.get("title") or pid), "hasExtensions": has_ext})
    for n in sorted(names):
        if n.startswith("packs/") and n.endswith("/pack.json"):
            pid = n.split("/")[1]
            if pid in seen:
                continue
            seen.add(pid)
            prefix = f"packs/{pid}/extensions/"
            has_ext = any(x.startswith(prefix) and not x.endswith("/") for x in names)
            out.append({"id": pid, "source": "third-party", "title": pid, "hasExtensions": has_ext})
    return out


def _preview_config(zf: zipfile.ZipFile) -> dict:
    try:
        data = json.loads(zf.read("config/provider-skeleton.json").decode("utf-8"))
    except (KeyError, json.JSONDecodeError, OSError):
        return {"providers": [], "activeProvider": ""}
    providers = data.get("providers") if isinstance(data, dict) else None
    return {
        "providers": list(providers.keys()) if isinstance(providers, dict) else [],
        "activeProvider": str((data or {}).get("activeProvider") or ""),
    }


def _preview_recipes(zf: zipfile.ZipFile) -> list[str]:
    return sorted(
        n[len("fetch-recipes/") :] for n in zf.namelist() if n.startswith("fetch-recipes/") and not n.endswith("/")
    )


def preview_backup(zip_bytes: bytes) -> dict:
    zf = _open_valid_zip(zip_bytes)
    manifest = _read_manifest(zf)
    skills = sorted(
        n.split("/")[1] for n in zf.namelist() if n.startswith("skills/") and n.endswith("/SKILL.md")
    )
    knowledge = sorted(
        Path(n).name for n in zf.namelist() if n.startswith("knowledge/sources/") and not n.endswith("/")
    )
    packs = _preview_packs(zf)
    return {
        "ok": True,
        "manifest": manifest,
        "contents": {
            "skills": skills,
            "knowledge": knowledge,
            "packs": packs,
            "config": _preview_config(zf),
            "templates": "templates.json" in zf.namelist(),
            "recipes": _preview_recipes(zf),
        },
        "needsConsent": any(p.get("hasExtensions") for p in packs),
    }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_backup_store.py -k preview -v`
Expected: 6 tests PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/backup_store.py backend/tests/test_backup_store.py
git commit -m "feat(backup): 导入预览与 zip 校验（大小/条目/穿越/manifest）"
```

---

### Task 3: backup_store.py — 恢复（apply_backup + 逐类恢复 + 回滚）

**Files:**
- Modify: `backend/backup_store.py`
- Test: `backend/tests/test_backup_store.py`

**Interfaces:**
- Produces: `async def apply_backup(zip_bytes: bytes, *, consent_extensions: bool) -> dict`。
- Consumes: Task 1/2 的函数；`install_skill`/`delete_skill`（user_skills_store）、`install_pack`/`uninstall_pack`（user_packs_store）、`ingest_document`（knowledge_store）、`write_templates`（templates_store）。

- [ ] **Step 1: 写失败的测试**

在 `test_backup_store.py` 追加：

```python
def _install_vendor_pack(tmp_path, monkeypatch) -> None:
    """把第三方包装进 tmp_path 数据目录（apply 里 uninstall 后重装的场景）。"""
    src = tmp_path / "packs-imported" / "vendor-logistics"
    (src / "skills" / "logistics-check").mkdir(parents=True)
    (src / "skills" / "logistics-check" / "SKILL.md").write_text(
        "---\nname: logistics-check\ndescription: 物流检查\nslash: 物流检查\n---\n# check\n", encoding="utf-8"
    )
    (src / "pack.json").write_text(
        json.dumps({"id": "vendor-logistics", "category": "自定义物流", "title": "物流", "skills": ["logistics-check"]}),
        encoding="utf-8",
    )
    user_packs_store.install_pack("vendor-logistics")


def test_apply_restores_skills_templates_config(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    (tmp_path / "fetch-recipes").mkdir()
    z = _backup_zip(extra={
        "skills/my-skill/SKILL.md": "---\nname: my-skill\ndescription: 演示\nslash: 演示\n---\n# demo\n",
        "templates.json": json.dumps({"templates": [{"id": "t1", "title": "T1", "prompt": "p"}]}),
        "config/provider-skeleton.json": json.dumps({"activeProvider": "qwen", "providers": {"qwen": {"baseUrl": "https://dashscope", "model": "qm", "smallFastModel": ""}}}),
        "fetch-recipes/amazon.com.json": json.dumps({"host": "amazon.com"}),
    })

    result = asyncio.run(backup_store.apply_backup(z, consent_extensions=False))

    assert result["restored"]["skills"] == ["my-skill"]
    assert (tmp_path / "skills" / "my-skill" / "SKILL.md").is_file()
    assert result["restored"]["templates"] is True
    assert json.loads((tmp_path / "templates.json").read_text(encoding="utf-8"))["templates"][0]["id"] == "t1"
    assert result["restored"]["config"] is True
    assert result["restored"]["recipes"] == ["amazon.com.json"]
    assert (tmp_path / "fetch-recipes" / "amazon.com.json").is_file()


def test_apply_restores_third_party_pack_requires_consent(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    _install_vendor_pack(tmp_path, monkeypatch)
    z = _backup_zip(extra={
        "installed-packs.json": json.dumps([{"id": "vendor-logistics", "source": "third-party"}]),
        "packs/vendor-logistics/pack.json": json.dumps({"id": "vendor-logistics", "category": "自定义物流", "title": "物流", "skills": ["logistics-check"]}),
        "packs/vendor-logistics/skills/logistics-check/SKILL.md": "---\nname: logistics-check\ndescription: 物流检查\nslash: 物流检查\n---\n# check\n",
    })
    result = asyncio.run(backup_store.apply_backup(z, consent_extensions=False))
    assert "vendor-logistics" in result["restored"]["packs"]
    assert (tmp_path / "packs-imported" / "vendor-logistics" / "pack.json").is_file()


def test_apply_extension_pack_needs_consent_flag(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    z = _backup_zip(extra={
        "installed-packs.json": json.dumps([{"id": "vendor-ext", "source": "third-party"}]),
        "packs/vendor-ext/pack.json": json.dumps({"id": "vendor-ext", "category": "自定义", "title": "Ext", "skills": [], "extensions": ["demo"]}),
        "packs/vendor-ext/extensions/demo/manifest.json": json.dumps({"name": "user.demo_fn", "description": "d", "entry": "handler.py", "network": False, "secrets": [], "timeoutMs": 5000}),
        "packs/vendor-ext/extensions/demo/handler.py": "def run(args):\n    return {}\n",
    })
    with pytest.raises(ValueError, match="需要用户同意"):
        asyncio.run(backup_store.apply_backup(z, consent_extensions=False))
    result = asyncio.run(backup_store.apply_backup(z, consent_extensions=True))
    assert "vendor-ext" in result["restored"]["packs"]
    assert result["consented"] == ["vendor-ext"]


def test_apply_does_not_overwrite_existing_key(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    monkeypatch.setattr(
        config_store,
        "_config",
        {"activeProvider": "deepseek", "providers": {"deepseek": {"apiKey": "existing-key", "baseUrl": "old", "model": "", "smallFastModel": ""}}},
    )
    z = _backup_zip(extra={
        "config/provider-skeleton.json": json.dumps({"activeProvider": "deepseek", "providers": {"deepseek": {"baseUrl": "new-url", "model": "m", "smallFastModel": ""}}}),
    })
    asyncio.run(backup_store.apply_backup(z, consent_extensions=False))
    cfg = config_store.get_config()
    assert cfg["providers"]["deepseek"]["apiKey"] == "existing-key"
    assert cfg["providers"]["deepseek"]["baseUrl"] == "new-url"


def test_apply_rolls_back_skills_when_pack_fails(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    z = _backup_zip(extra={
        "skills/good-skill/SKILL.md": "---\nname: good-skill\ndescription: 好\nslash: 好\n---\n# g\n",
        "installed-packs.json": json.dumps([{"id": "no-such-pack", "source": "third-party"}]),
        "packs/no-such-pack/pack.json": json.dumps({"id": "no-such-pack", "skills": []}),
    })
    with pytest.raises(ValueError):
        asyncio.run(backup_store.apply_backup(z, consent_extensions=False))
    assert not (tmp_path / "skills" / "good-skill").exists()
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd backend && python -m pytest tests/test_backup_store.py -k apply -v`
Expected: FAIL，`AttributeError: module 'backup_store' has no attribute 'apply_backup'`。

- [ ] **Step 3: 实现恢复**

在 `backup_store.py` 末尾追加：

```python
async def _restore_skills(staging: Path) -> list[str]:
    skills_root = staging / "skills"
    if not skills_root.is_dir():
        return []
    restored = []
    for md in sorted(skills_root.glob("*/SKILL.md")):
        parsed = install_skill(None, md.read_text(encoding="utf-8"))
        restored.append(parsed["id"])
    return restored


def _restore_packs(staging: Path, *, consent_extensions: bool) -> tuple[list[str], list[str]]:
    recs: list[dict] = []
    rec_file = staging / "installed-packs.json"
    if rec_file.is_file():
        try:
            data = json.loads(rec_file.read_text(encoding="utf-8"))
            if isinstance(data, list):
                recs = [r for r in data if isinstance(r, dict)]
        except (json.JSONDecodeError, OSError):
            pass
    restored: list[str] = []
    extended: list[str] = []
    for rec in recs:
        pid = str(rec.get("id") or "").strip()
        if not pid:
            continue
        source = str(rec.get("source") or "")
        if source != "official":
            src = staging / "packs" / pid
            if not (src / "pack.json").is_file():
                continue
            dest = user_packs_store.IMPORTED_PACKS_DIR / pid
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest)
            src_dir = src
        else:
            src_dir = user_packs_store.PACKS_DIR / pid
        has_ext = (src_dir / "extensions").is_dir() and any((src_dir / "extensions").iterdir())
        try:
            uninstall_pack(pid)
        except Exception:
            pass
        install_pack(pid, consent_extensions=consent_extensions)
        restored.append(pid)
        if has_ext:
            extended.append(pid)
    return restored, extended


async def _restore_knowledge(staging: Path) -> list[str]:
    src = staging / "knowledge" / "sources"
    if not src.is_dir():
        return []
    restored = []
    for p in sorted(src.iterdir()):
        if p.is_file() and p.suffix.lower() in ALLOWED_KNOWLEDGE_EXT:
            try:
                content = p.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            await ingest_document(p.name, content)
            restored.append(p.name)
    return restored


def _restore_config(staging: Path) -> bool:
    skel_file = staging / "config" / "provider-skeleton.json"
    if not skel_file.is_file():
        return False
    try:
        skel = json.loads(skel_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    providers = skel.get("providers") if isinstance(skel, dict) else None
    if not isinstance(providers, dict):
        return False
    cfg = get_config()
    cur = cfg.setdefault("providers", {})
    for pid, p in providers.items():
        entry = cur.setdefault(pid, {})
        for k in ("baseUrl", "model", "smallFastModel"):
            if p.get(k):
                entry[k] = p[k]
    if isinstance(skel, dict) and skel.get("activeProvider") in cur:
        cfg["activeProvider"] = skel["activeProvider"]
    save_config(cfg)
    return True


def _restore_templates(staging: Path) -> bool:
    tpl = staging / "templates.json"
    if not tpl.is_file():
        return False
    try:
        data = json.loads(tpl.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    items = data if isinstance(data, list) else (data.get("templates") if isinstance(data, dict) else [])
    templates_store.write_templates(None, items if isinstance(items, list) else [])
    return True


def _restore_recipes(staging: Path) -> list[str]:
    src = staging / "fetch-recipes"
    if not src.is_dir():
        return []
    dest = fetch_recipe.RECIPES_DIR
    dest.mkdir(parents=True, exist_ok=True)
    restored = []
    for p in sorted(src.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict):
            (dest / p.name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            restored.append(p.name)
    return restored


async def apply_backup(zip_bytes: bytes, *, consent_extensions: bool) -> dict:
    zf = _open_valid_zip(zip_bytes)
    _read_manifest(zf)
    staging = _staging_dir()
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    installed_skills: list[str] = []
    installed_packs: list[str] = []
    extended_packs: list[str] = []
    try:
        zf.extractall(staging)
        installed_skills = await _restore_skills(staging)
        installed_packs, extended_packs = _restore_packs(staging, consent_extensions=consent_extensions)
        restored_knowledge = await _restore_knowledge(staging)
        restored_config = _restore_config(staging)
        restored_templates = _restore_templates(staging)
        restored_recipes = _restore_recipes(staging)
    except Exception:
        for sid in installed_skills:
            try:
                delete_skill(None, sid)
            except Exception:
                pass
        for pid in installed_packs:
            try:
                uninstall_pack(pid)
            except Exception:
                pass
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return {
        "ok": True,
        "restored": {
            "skills": installed_skills,
            "knowledge": restored_knowledge,
            "packs": installed_packs,
            "config": restored_config,
            "templates": restored_templates,
            "recipes": restored_recipes,
        },
        "consented": extended_packs,
    }
```

在 `backup_store.py` 的 import 区追加：

```python
from knowledge_store import ingest_document
```

在模块末尾、`apply_backup` 定义之前追加 staging 目录解析函数：

```python
def _staging_dir() -> Path:
    return CONFIG_DIR / ".staging-backup"
```

（Task 1 已把 `CONFIG_DIR` 加进 `from config_store import …`，无需重复导入。）

- [ ] **Step 4: 运行测试确认通过**

Run: `cd backend && python -m pytest tests/test_backup_store.py -v`
Expected: 全部（导出 2 + 预览 6 + apply 5）PASS。若 `test_apply_restores_third_party_pack_requires_consent` 报「skills 与 skills/ 目录不一致」，检查备份 zip 里 `pack.json` 的 `skills` 列表与 `packs/<pid>/skills/<sid>/SKILL.md` 的 frontmatter `name` 一致（测试里已对齐）。

- [ ] **Step 5: 提交**

```bash
git add backend/backup_store.py backend/tests/test_backup_store.py
git commit -m "feat(backup): 导入恢复（技能/场景包/知识/配置骨架/模板/recipe，扩展重新同意，失败回滚）"
```

---

### Task 4: server.py — 三个备份端点

**Files:**
- Modify: `backend/server.py`（顶部 import 区 + 末尾路由区）

**Interfaces:**
- Consumes: `backup_store.export_backup` / `preview_backup` / `apply_backup` / `MAX_BACKUP_BYTES`。
- Produces: `GET /api/backup/export`、`POST /api/backup/import/preview`、`POST /api/backup/import/apply`。
- 备注：本仓库 server.py 无单元测试（store 层测试已覆盖逻辑），此任务用 curl 手工验证端点接线，照抄现有 `api_import_pack` 的 multipart/错误处理模式。

- [ ] **Step 1: 加 import**

在 `server.py` 的 import 区（`from user_packs_store import …` 块之后）追加：

```python
from backup_store import (
    MAX_BACKUP_BYTES,
    apply_backup,
    export_backup,
    preview_backup,
)
```

在 `from fastapi import FastAPI, HTTPException, Request, UploadFile, File` 行追加 `Form`：

```python
from fastapi import FastAPI, Form, HTTPException, Request, UploadFile, File
```

在 `from datetime import …` 附近（若无则新增）加：

```python
from datetime import date
```

- [ ] **Step 2: 加三个端点**

在 `server.py` 末尾（`@app.delete("/api/user-skills/{skill_id}")` 之后、`@app.get("/{full_path:path}")` 之前）追加：

```python
@app.get("/api/backup/export")
async def api_backup_export(request: Request):
    require_loopback(request)
    try:
        data = export_backup()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    fname = f"sheetwise-backup-{date.today().isoformat()}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


@app.post("/api/backup/import/preview")
async def api_backup_preview(request: Request, file: UploadFile = File(...)):
    require_loopback(request)
    data = await file.read(MAX_BACKUP_BYTES + 1)
    if len(data) > MAX_BACKUP_BYTES:
        raise HTTPException(400, "备份超过 50MB 上限")
    try:
        return preview_backup(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/backup/import/apply")
async def api_backup_apply(
    request: Request,
    file: UploadFile = File(...),
    consentExtensions: bool = Form(False),
):
    require_loopback(request)
    data = await file.read(MAX_BACKUP_BYTES + 1)
    if len(data) > MAX_BACKUP_BYTES:
        raise HTTPException(400, "备份超过 50MB 上限")
    try:
        return await apply_backup(data, consent_extensions=consentExtensions)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
```

- [ ] **Step 3: 语法检查**

Run: `cd backend && python -m py_compile server.py backup_store.py`
Expected: 无输出（成功）。

- [ ] **Step 4: 手工验证端点接线**

Run: `cd backend && python server.py`（另一终端）。
然后（在 backend 目录）执行：

```bash
curl -sk https://localhost:8765/api/backup/export -o test-backup.zip
python -c "import zipfile,json;z=zipfile.ZipFile('test-backup.zip');print(json.loads(z.read('manifest.json'))['format'])"
curl -sk -X POST https://localhost:8765/api/backup/import/preview -F "file=@test-backup.zip"
```

Expected: 第一条下载 zip 且 manifest format 为 `sheetwise-backup`；第三条返回 `{"ok":true,...}` 预览 JSON。

- [ ] **Step 5: 提交**

```bash
git add backend/server.py
git commit -m "feat(backup): 备份导出/导入三个端点（loopback 校验 + multipart）"
```

---

### Task 5: 设置面板 —「备份与迁移」节

**Files:**
- Create: `addin/src/taskpane/components/BackupSection.tsx`
- Modify: `addin/src/taskpane/components/SettingsPanel.tsx`（顶部 import + JSX 尾部）

**Interfaces:**
- Consumes: `GET /api/backup/export`（zip 下载）、`POST /api/backup/import/preview`、`POST /api/backup/import/apply`（multipart，`file` 字段；consent 时加 `consentExtensions=true`）。
- Produces: `BackupSection` React 组件，`props: { proxyUrl: string }`。

- [ ] **Step 1: 新建 BackupSection 组件**

创建 `addin/src/taskpane/components/BackupSection.tsx`：

```tsx
/**
 * BackupSection.tsx — 备份与迁移：导出 / 导入备份（不含 API Key，导入后需重新填写）。
 */
import React, { useCallback, useRef, useState } from 'react';

interface Props {
  proxyUrl: string;
}

interface PreviewData {
  skills: string[];
  knowledge: string[];
  packs: Array<{ id: string; source: string; hasExtensions: boolean }>;
  needsConsent: boolean;
}

export default function BackupSection({ proxyUrl }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch(`${proxyUrl}/api/backup/export`);
      if (!r.ok) {
        const err = await r.text();
        setMsg(`导出失败：${r.status} ${err}`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sheetwise-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('已导出备份文件。');
    } catch {
      setMsg('导出失败：无法连接后端');
    } finally {
      setBusy(false);
    }
  }, [proxyUrl]);

  const handlePreview = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${proxyUrl}/api/backup/import/preview`, { method: 'POST', body: form });
      if (!r.ok) {
        const err = await r.text();
        setMsg(`导入失败：${r.status} ${err}`);
        return;
      }
      const data = (await r.json()) as {
        contents: { skills?: string[]; knowledge?: string[]; packs?: PreviewData['packs'] };
        needsConsent?: boolean;
      };
      setPreview({
        skills: data.contents?.skills || [],
        knowledge: data.contents?.knowledge || [],
        packs: data.contents?.packs || [],
        needsConsent: !!data.needsConsent,
      });
    } catch {
      setMsg('读取备份失败：无法连接后端');
    } finally {
      setBusy(false);
    }
  }, [file, proxyUrl]);

  const handleApply = useCallback(async () => {
    if (!file) return;
    if (preview?.needsConsent && !consent) {
      setMsg('请先勾选「我信任这些扩展」再导入。');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (consent) form.append('consentExtensions', 'true');
      const r = await fetch(`${proxyUrl}/api/backup/import/apply`, { method: 'POST', body: form });
      if (!r.ok) {
        const err = await r.text();
        setMsg(`导入失败：${r.status} ${err}`);
        return;
      }
      const result = (await r.json()) as { restored?: { skills?: string[]; knowledge?: string[]; packs?: string[] } };
      const list = [
        ...(result.restored?.skills?.length ? [`技能 ${result.restored.skills.length}`] : []),
        ...(result.restored?.knowledge?.length ? [`知识 ${result.restored.knowledge.length}`] : []),
        ...(result.restored?.packs?.length ? [`场景包 ${result.restored.packs.length}`] : []),
      ];
      setMsg(`导入完成：${list.join('、')}。`);
      setPreview(null);
      setConsent(false);
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setMsg('导入失败：无法连接后端');
    } finally {
      setBusy(false);
    }
  }, [file, preview, consent, proxyUrl]);

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
      <h3>备份与迁移</h3>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
        备份不含 API Key，导入后请在设置中重新填写。
      </div>
      <button onClick={() => void handleExport()} disabled={busy}>
        {busy ? '处理中...' : '导出备份'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".zip"
        style={{ display: 'block', margin: '8px 0' }}
        onChange={(e) => handlePreviewGuard(e.target.files?.[0] ?? null)}
      />
      {file && !preview && (
        <button onClick={() => void handlePreview()} disabled={busy}>
          预览备份
        </button>
      )}
      {preview && (
        <div style={{ margin: '8px 0' }}>
          <div style={{ fontSize: 12 }}>
            备份含：技能 {preview.skills.length} 个、知识 {preview.knowledge.length} 个、场景包 {preview.packs.length} 个。
          </div>
          {preview.needsConsent && (
            <label style={{ display: 'block', margin: '6px 0', color: '#dc2626', fontSize: 12 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              此备份含本机扩展（user.*），我信任这些扩展
            </label>
          )}
          <button onClick={() => void handleApply()} disabled={busy}>
            确认导入
          </button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6 }}>{msg}</div>}
    </div>
  );

  function handlePreviewGuard(f: File | null) {
    setFile(f);
    setPreview(null);
    setMsg('');
  }
}
```

- [ ] **Step 2: 把组件挂进 SettingsPanel**

修改 `SettingsPanel.tsx`：

(a) 顶部 import 区（`import { API_BASE } from '../../services/api-config';` 之后）追加：

```tsx
import BackupSection from './BackupSection';
```

(b) 在 return 的最外层 `<div className="settings-panel">` 的收尾 `</div>` 之前（即 `configuredProviders` 条件块之后）追加：

```tsx
      <BackupSection proxyUrl={proxyUrl} />
```

- [ ] **Step 3: 类型检查与构建**

Run: `cd addin && npm run typecheck && npm run build`
Expected: 两者退出码 0，无 TS 错误。

- [ ] **Step 4: 手工验证 UI**

Run: `cd addin && npm start`（或 `launch.bat`），在 Excel 任务窗格 ⚙ 设置里：
1. 点「导出备份」→ 浏览器/加载项下载 `sheetwise-backup-<date>.zip`
2. 点「预览备份」选刚才的 zip → 显示「备份含：技能 N 个…」
3. 点「确认导入」→ 显示「导入完成：…」
4. 若备份含扩展：预览出现红色「我信任这些扩展」勾选，未勾选点确认会提示先勾选。

- [ ] **Step 5: 提交**

```bash
git add addin/src/taskpane/components/BackupSection.tsx addin/src/taskpane/components/SettingsPanel.tsx
git commit -m "feat(backup): 设置面板「备份与迁移」节（导出/预览/确认导入）"
```

---

### Task 6: 更新迁移指南

**Files:**
- Modify: `docs/migration.md`

- [ ] **Step 1: 改写步骤 3**

把 `docs/migration.md` 里「### 3. 迁用户数据」整节替换为：

```markdown
### 3. 迁用户数据（旧机台 → 新机台）

用产品内功能迁移，不再手工拷目录：

1. **旧机台**：Excel 侧边栏 ⚙ 设置 → 「备份与迁移」→「导出备份」，得到一个 `sheetwise-backup-<date>.zip`。
2. **搬文件**：把 zip 通过任意通道（U 盘 / 网盘 / 聊天工具）传到新机台。备份不含 API Key，无需特殊安全通道。
3. **新机台**：⚙ 设置 →「备份与迁移」→ 选 zip →「预览备份」→「确认导入」。
4. **重填 Key**：导入后到设置面板重新填写各 provider 的 API Key。

> 备份不含 API Key；含本机扩展（user.*）的场景包导入后需要重新信任。
```

同时把该节上方引用「拷贝 `~/.claude-excel-web/` 目录」的旧说明、以及「config.json 含 API Key 走安全通道」的风险条目删除或改写（`docs/migration.md` 的「边界与风险」里对应行改为：备份不含密钥，迁移不再搬 config.json）。

- [ ] **Step 2: 校验 markdown**

Run: 无脚本，目视确认表格/列表格式与仓库其他文档一致（表头分隔行用 `| --- | --- |`）。

- [ ] **Step 3: 提交**

```bash
git add docs/migration.md
git commit -m "docs(migration): 迁移改为设置面板导出/导入备份"
```

---

## 收尾

全部 6 个任务完成后：

1. Run: `cd backend && python -m pytest tests/test_backup_store.py -v` → 全部 PASS（12 个测试）。
2. Run: `cd backend && python -m pytest tests/ -v` → 既有测试不回归。
3. Run: `cd addin && npm run typecheck && npm run build` → 无错误。
4. 跑一遍 spec §8 的手工场景：导出→（删掉部分数据）→导入→确认技能/知识/包/模板/recipe 回来、Key 未动。
5. 若全部通过，最后 commit（若还有零散改动）并把分支情况告知：二段协同按 `docs/coordination.md`，实施由 Codex 执行，Claude 只审 diff 不实现。
