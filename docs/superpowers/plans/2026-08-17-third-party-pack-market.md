# 三方 Pack 市场框架 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让第三方 pack 能经「本地目录 + zip 导入」进目录、经「export 打 zip」被作者分享，并在安装界面以「第三方」徽标展示、可安装/卸载。

**Architecture:** 新增 `~/.claude-excel-web/packs-imported/` 作为第三方源目录，与运行时 `packs/` 分离。`list_packs` 合并官方+第三方并打 `source` 标记；`install_pack`/`uninstall_pack` 改为 source 感知；新增 `import_pack_zip`/`remove_imported_pack`/`export_pack_zip` 三个后端函数 + 三条路由；前端 PackMenu 加导入按钮/徽标/删除来源/导出。

**Tech Stack:** Python 3.11 / FastAPI / pytest · TypeScript / React（Office addin taskpane）/ webpack

**Spec:** `docs/superpowers/specs/2026-08-17-third-party-pack-market-design.md`

## Global Constraints

- `IMPORTED_PACKS_DIR = ~/.claude-excel-web/packs-imported`（独立于 `RUNTIME_PACKS_DIR`，防 `list_extensions` 误扫未装扩展）。
- 官方包 `category` 必须 ∈ `taxonomy.json`；第三方包自由标签（`categoryLabel` = `pack.category` 原样，空则 `"第三方"`）。
- 导入 zip：总解压 ≤ 5MB、条目 ≤ 200、拒绝 `..`/绝对路径/反斜杠路径、根须有 `pack.json`、id 冲突拒绝（错误提示 `已存在同名包: {id}，请改用 {vendor}-{pack} 命名`）。
- `installed_packs.json` record 增加 `source` 与 `skills`；`uninstall_pack` 从 record 读 `skills`，不依赖源目录。
- 含 extensions 的包安装仍必须 `consent_extensions=True`；capability hash / secrets / `clean_env` 模型不变。
- 每个任务遵循 TDD（先写测试→确认失败→实现→确认通过）。提交前需用户确认（仓库 CLAUDE.md 规定 commit 仅当用户要求）。

---

### Task 1: `IMPORTED_PACKS_DIR` + `_resolve_pack_dir` + `list_packs` 合并 source

**Files:**
- Modify: `backend/user_packs_store.py`（常量、`_resolve_pack_dir`、`_catalog_entry`、`list_packs`）
- Test: `backend/tests/test_user_packs_store.py`

**Interfaces:**
- Consumes: 现有 `PACKS_DIR`、`_read_json`、`_list_skills`、`_list_knowledge`、`list_catalog_extensions`、`category_label`、`_installed_ids`。
- Produces: `IMPORTED_PACKS_DIR: Path`；`_resolve_pack_dir(pack_id) -> tuple[Path, str]`；`list_packs() -> list[dict]`（每项含 `source: "official"|"third-party"`）。

- [ ] **Step 1: 写失败测试**

在 `backend/tests/test_user_packs_store.py` 末尾追加：

```python
def test_list_packs_merges_imported_with_source(tmp_path, monkeypatch):
    import user_packs_store

    src = tmp_path / "packs-imported" / "vendor-shipping"
    (src / "skills" / "ship-check").mkdir(parents=True)
    (src / "skills" / "ship-check" / "SKILL.md").write_text(
        "---\nname: ship-check\ndescription: 物流对账\nslash: 物流对账\n---\n# ship\n",
        encoding="utf-8",
    )
    (src / "pack.json").write_text(
        json.dumps({"id": "vendor-shipping", "category": "跨境物流", "title": "物流对账", "skills": ["ship-check"]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")

    packs = list_packs()
    official = next(x for x in packs if x["id"] == "cross-border-ecommerce-research")
    third = next(x for x in packs if x["id"] == "vendor-shipping")
    assert official["source"] == "official"
    assert third["source"] == "third-party"
    assert third["categoryLabel"] == "跨境物流"
    assert official["categoryLabel"] == "跨境电商"
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py::test_list_packs_merges_imported_with_source -v`
Expected: FAIL（`list_packs` 无 `source` 字段 / 不扫 imported 目录）。

- [ ] **Step 3: 实现**

在 `backend/user_packs_store.py`：

```python
IMPORTED_PACKS_DIR = CONFIG_DIR / "packs-imported"


def _resolve_pack_dir(pack_id: str) -> tuple[Path, str]:
    official = PACKS_DIR / pack_id
    if (official / "pack.json").is_file():
        return official, "official"
    imported = IMPORTED_PACKS_DIR / pack_id
    if (imported / "pack.json").is_file():
        return imported, "third-party"
    raise ValueError("示例包不存在: " + pack_id)


def _catalog_entry(pack_dir: Path, source: str) -> dict | None:
    pf = pack_dir / "pack.json"
    if not pf.is_file():
        return None
    try:
        pack = _read_json(pf)
    except ValueError:
        return None
    pid = str(pack.get("id") or "").strip()
    if not pid:
        return None
    category = str(pack.get("category") or "").strip()
    cat_label = category_label(category) if source == "official" else (category or "第三方")
    return {
        "id": pid,
        "source": source,
        "category": category,
        "categoryLabel": cat_label,
        "title": str(pack.get("title") or pid),
        "description": str(pack.get("description") or ""),
        "version": str(pack.get("version") or ""),
        "gate": str(pack.get("gate") or ""),
        "skills": _list_skills(pack_dir),
        "knowledge": _list_knowledge(pack_dir),
        "extensions": list_catalog_extensions(pack_dir),
        "deps": pack.get("deps") or {},
        "installed": pid in _installed_ids(),
    }


def list_packs() -> list[dict]:
    out: list[dict] = []
    if PACKS_DIR.is_dir():
        for pack_dir in sorted(PACKS_DIR.iterdir()):
            e = _catalog_entry(pack_dir, "official")
            if e:
                out.append(e)
    if IMPORTED_PACKS_DIR.is_dir():
        for pack_dir in sorted(IMPORTED_PACKS_DIR.iterdir()):
            e = _catalog_entry(pack_dir, "third-party")
            if e:
                out.append(e)
    return out
```

删除旧 `list_packs` 函数体（保留函数名）。旧函数里 `TAXONOMY_FILE`/`load_taxonomy`/`category_label` 引用不受影响（`category_label` 仍被 `_catalog_entry` 用）。

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py -q`
Expected: 现有测试（`test_list_packs_lists_split_cross_border_packs` 等）+ 新测试全 PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/user_packs_store.py backend/tests/test_user_packs_store.py
git commit -m "feat(packs): list_packs 合并第三方源并打 source 标记"
```
（若用户要求先不提交则跳过，改在最后统一提交。）

---

### Task 2: `install_pack` source 感知 + record 记录 `source`/`skills`

**Files:**
- Modify: `backend/user_packs_store.py`（`install_pack`）
- Test: `backend/tests/test_user_packs_store.py`

**Interfaces:**
- Consumes: `_resolve_pack_dir`、`_read_json`、`load_taxonomy`、`_list_skills`、`list_catalog_extensions`、`_list_knowledge`、`install_skill`、`delete_skill`、`RUNTIME_PACKS_DIR`、`_load_runtime_manifests`、`pack_capability_hash`。
- Produces: `install_pack` 的 installed record 含 `source`、`skills`。

- [ ] **Step 1: 写失败测试**

```python
def test_install_third_party_pack_allows_free_category(tmp_path, monkeypatch):
    import user_skills_store
    import user_packs_store

    src = tmp_path / "packs-imported" / "vendor-logistics"
    (src / "skills" / "logistics-check").mkdir(parents=True)
    (src / "skills" / "logistics-check" / "SKILL.md").write_text(
        "---\nname: logistics-check\ndescription: 物流检查\nslash: 物流检查\n---\n# check\n",
        encoding="utf-8",
    )
    (src / "pack.json").write_text(
        json.dumps({"id": "vendor-logistics", "category": "自定义物流分类", "title": "物流", "skills": ["logistics-check"]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    result = install_pack("vendor-logistics")
    assert result["packId"] == "vendor-logistics"
    rec = json.loads((tmp_path / "installed_packs.json").read_text(encoding="utf-8"))
    assert rec[0]["source"] == "third-party"
    assert rec[0]["skills"] == ["logistics-check"]
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py::test_install_third_party_pack_allows_free_category -v`
Expected: FAIL（第三方 category 不在 taxonomy → 现在会抛 `category 不在 taxonomy 里`；record 无 `source`/`skills`）。

- [ ] **Step 3: 实现**

在 `install_pack`：

```python
    pack_dir, source = _resolve_pack_dir(pid)
    pf = pack_dir / "pack.json"
    pack = _read_json(pf)
    if str(pack.get("id") or "").strip() != pid:
        raise ValueError("pack.json 的 id 与目录名不一致")

    category = str(pack.get("category") or "").strip()
    if source == "official" and category and not any(c.get("id") == category for c in load_taxonomy()):
        raise ValueError(f"category 不在 taxonomy 里: {category}")
```

把 record 追加改为：

```python
    records.append(
        {
            "id": pid,
            "source": source,
            "skills": [s["id"] for s in result_skills],
            "installedAt": now,
            "version": str(pack.get("version") or ""),
            "capabilityHash": cap_hash if extensions else "",
            "consentedAt": now if extensions else "",
        }
    )
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py -q`
Expected: 全 PASS（现有 `test_install_*` 通过；record 多了字段不影响断言）。

- [ ] **Step 5: 提交**

```bash
git add backend/user_packs_store.py backend/tests/test_user_packs_store.py
git commit -m "feat(packs): install_pack 支持第三方源并记录 source/skills"
```

---

### Task 3: `uninstall_pack` 从 record 读 skills

**Files:**
- Modify: `backend/user_packs_store.py`（`uninstall_pack`）
- Test: `backend/tests/test_user_packs_store.py`

**Interfaces:**
- Consumes: `_read_installed_records`、`_write_installed`、`_resolve_pack_dir`、`_list_skills`、`delete_skill`、`RUNTIME_PACKS_DIR`。
- Produces: `uninstall_pack` 在源目录被删时仍能卸。

- [ ] **Step 1: 写失败测试**

```python
def test_uninstall_uses_record_skills_when_source_removed(tmp_path, monkeypatch):
    import shutil
    import user_skills_store
    import user_packs_store
    import user_extension_registry

    src = tmp_path / "packs-imported" / "vendor-logistics"
    (src / "skills" / "logistics-check").mkdir(parents=True)
    (src / "skills" / "logistics-check" / "SKILL.md").write_text(
        "---\nname: logistics-check\ndescription: 物流检查\nslash: 物流检查\n---\n# check\n",
        encoding="utf-8",
    )
    (src / "pack.json").write_text(
        json.dumps({"id": "vendor-logistics", "category": "物流", "title": "物流", "skills": ["logistics-check"]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    install_pack("vendor-logistics")
    shutil.rmtree(src)  # 源目录被删

    result = uninstall_pack("vendor-logistics")
    assert result["packId"] == "vendor-logistics"
    assert not (tmp_path / "skills" / "logistics-check").exists()
    assert json.loads((tmp_path / "installed_packs.json").read_text(encoding="utf-8")) == []
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py::test_uninstall_uses_record_skills_when_source_removed -v`
Expected: FAIL（现在 `uninstall_pack` 读 `_list_skills(PACKS_DIR / pid)`，源已删拿不到 skill ids → 技能删不掉）。

- [ ] **Step 3: 实现**

替换 `uninstall_pack`：

```python
def uninstall_pack(pack_id: str) -> dict:
    from user_skills_store import delete_skill

    pid = str(pack_id or "").strip()
    if not pid:
        raise ValueError("packId required")
    records = _read_installed_records()
    rec = next((r for r in records if str(r.get("id") or "").strip() == pid), None)
    if rec is None:
        raise ValueError("示例包未安装: " + pid)

    skill_ids = list(rec.get("skills") or [])
    if not skill_ids:
        try:
            skill_ids = [s["id"] for s in _list_skills(_resolve_pack_dir(pid)[0])]
        except ValueError:
            pass
    for sid in skill_ids:
        try:
            delete_skill(None, sid)
        except (FileNotFoundError, ValueError):
            pass

    runtime_pack = RUNTIME_PACKS_DIR / pid
    if runtime_pack.exists():
        shutil.rmtree(runtime_pack)
    _write_installed([r for r in records if str(r.get("id") or "").strip() != pid])
    return {"packId": pid, "skills": skill_ids}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py -q`
Expected: 全 PASS（含现有 `test_uninstall_pack_removes_skill_extensions_record`、`test_uninstall_pack_unknown_id_raises`）。

- [ ] **Step 5: 提交**

```bash
git add backend/user_packs_store.py backend/tests/test_user_packs_store.py
git commit -m "feat(packs): uninstall_pack 从 installed record 读 skills，源可删"
```

---

### Task 4: `import_pack_zip`（zip-slip 防护 + 限制 + id 冲突）

**Files:**
- Modify: `backend/user_packs_store.py`（`io`/`zipfile` import、`import_pack_zip`）
- Test: `backend/tests/test_user_packs_store.py`

**Interfaces:**
- Consumes: `IMPORTED_PACKS_DIR`、`PACKS_DIR`、`_read_json`、`_catalog_entry`。
- Produces: `import_pack_zip(zip_bytes: bytes) -> dict`（返回第三方 catalog entry）。

- [ ] **Step 1: 写失败测试**

```python
def _make_zip(entries):
    import io
    import zipfile
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in entries.items():
            zf.writestr(name, content)
    return buf.getvalue()


def test_import_pack_zip_valid(tmp_path, monkeypatch):
    import user_packs_store
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    z = _make_zip({"pack.json": json.dumps({"id": "vendor-pack", "category": "自定义", "title": "V", "skills": []})})
    entry = user_packs_store.import_pack_zip(z)
    assert entry["source"] == "third-party"
    assert entry["id"] == "vendor-pack"
    assert (tmp_path / "packs-imported" / "vendor-pack" / "pack.json").is_file()


def test_import_pack_zip_missing_pack_json(tmp_path, monkeypatch):
    import user_packs_store
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    with pytest.raises(ValueError, match="pack.json"):
        user_packs_store.import_pack_zip(_make_zip({"skills/x": "1"}))


def test_import_pack_zip_rejects_slip(tmp_path, monkeypatch):
    import user_packs_store
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    with pytest.raises(ValueError, match="非法路径"):
        user_packs_store.import_pack_zip(_make_zip({"../evil": "x"}))


def test_import_pack_zip_rejects_id_collision(tmp_path, monkeypatch):
    import user_packs_store
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    z = _make_zip({"pack.json": json.dumps({"id": "cross-border-ecommerce-research", "skills": []})})
    with pytest.raises(ValueError, match="已存在同名包"):
        user_packs_store.import_pack_zip(z)
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py -k import_pack_zip -v`
Expected: FAIL（`import_pack_zip` 不存在 → ImportError/AttributeError）。

- [ ] **Step 3: 实现**

在 `user_packs_store.py` 顶部加 `import io`、`import zipfile`；文件内加：

```python
MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ENTRIES = 200


def _safe_zip_name(name: str) -> bool:
    if not name or name.startswith("/") or "\\" in name:
        return False
    return ".." not in name.split("/")


def _extract_import_zip(zip_bytes: bytes, dest: Path) -> None:
    if len(zip_bytes) > MAX_IMPORT_BYTES:
        raise ValueError("zip 超过 5MB 上限")
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError("无法解析 zip") from exc
    infos = zf.infolist()
    if len(infos) > MAX_IMPORT_ENTRIES:
        raise ValueError(f"zip 条目超过 {MAX_IMPORT_ENTRIES} 上限")
    for info in infos:
        if not _safe_zip_name(info.filename):
            raise ValueError("zip 含非法路径: " + info.filename)
    if not any(info.filename == "pack.json" and not info.is_dir() for info in infos):
        raise ValueError("zip 根目录需要 pack.json")
    dest.mkdir(parents=True, exist_ok=True)
    zf.extractall(dest)


def import_pack_zip(zip_bytes: bytes) -> dict:
    IMPORTED_PACKS_DIR.mkdir(parents=True, exist_ok=True)
    staging = IMPORTED_PACKS_DIR / ".staging"
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    try:
        _extract_import_zip(zip_bytes, staging)
        pack = _read_json(staging / "pack.json")
        pid = str(pack.get("id") or "").strip()
        if not pid:
            raise ValueError("pack.json 需要 id")
        if (PACKS_DIR / pid / "pack.json").is_file() or (IMPORTED_PACKS_DIR / pid / "pack.json").is_file():
            raise ValueError(f"已存在同名包: {pid}，请改用 {{vendor}}-{{pack}} 命名")
        dest = IMPORTED_PACKS_DIR / pid
        if dest.exists():
            shutil.rmtree(dest)
        staging.rename(dest)
        return _catalog_entry(dest, "third-party")
    except Exception:
        if staging.exists():
            shutil.rmtree(staging)
        raise
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py -k import_pack_zip -v`
Expected: 4 个新测试全 PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/user_packs_store.py backend/tests/test_user_packs_store.py
git commit -m "feat(packs): import_pack_zip 带 zip-slip 防护与 id 冲突拒绝"
```

---

### Task 5: `remove_imported_pack`

**Files:**
- Modify: `backend/user_packs_store.py`
- Test: `backend/tests/test_user_packs_store.py`

**Interfaces:**
- Consumes: `IMPORTED_PACKS_DIR`、`_installed_ids`。
- Produces: `remove_imported_pack(pack_id) -> dict`（已装拒绝）。

- [ ] **Step 1: 写失败测试**

```python
def test_remove_imported_pack(tmp_path, monkeypatch):
    import user_packs_store

    src = tmp_path / "packs-imported" / "vendor-x"
    src.mkdir(parents=True)
    (src / "pack.json").write_text(json.dumps({"id": "vendor-x", "skills": []}), encoding="utf-8")
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    user_packs_store.remove_imported_pack("vendor-x")
    assert not src.exists()

    installed = tmp_path / "packs-imported" / "vendor-y"
    installed.mkdir(parents=True)
    (installed / "pack.json").write_text(json.dumps({"id": "vendor-y", "skills": []}), encoding="utf-8")
    (tmp_path / "installed_packs.json").write_text(json.dumps([{"id": "vendor-y"}]), encoding="utf-8")
    with pytest.raises(ValueError, match="请先卸载"):
        user_packs_store.remove_imported_pack("vendor-y")
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py::test_remove_imported_pack -v`
Expected: FAIL（`remove_imported_pack` 不存在）。

- [ ] **Step 3: 实现**

```python
def remove_imported_pack(pack_id: str) -> dict:
    pid = str(pack_id or "").strip()
    if not pid:
        raise ValueError("packId required")
    if pid in _installed_ids():
        raise ValueError("请先卸载: " + pid)
    dest = IMPORTED_PACKS_DIR / pid
    if not (dest / "pack.json").is_file():
        raise ValueError("第三方包不存在: " + pid)
    shutil.rmtree(dest)
    return {"packId": pid}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py::test_remove_imported_pack -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/user_packs_store.py backend/tests/test_user_packs_store.py
git commit -m "feat(packs): remove_imported_pack 删除第三方源"
```

---

### Task 6: `export_pack_zip`

**Files:**
- Modify: `backend/user_packs_store.py`
- Test: `backend/tests/test_user_packs_store.py`

**Interfaces:**
- Consumes: `_resolve_pack_dir`、`_read_json`。
- Produces: `export_pack_zip(pack_id: str) -> bytes`（zip 内存流）。

- [ ] **Step 1: 写失败测试**

```python
def test_export_import_roundtrip(tmp_path, monkeypatch):
    import shutil
    import user_packs_store

    src = tmp_path / "packs-imported" / "vendor-z"
    (src / "skills" / "zs").mkdir(parents=True)
    (src / "skills" / "zs" / "SKILL.md").write_text(
        "---\nname: zs\ndescription: z\nslash: z\n---\n# z\n", encoding="utf-8"
    )
    (src / "pack.json").write_text(
        json.dumps({"id": "vendor-z", "category": "第三方", "title": "Z", "skills": ["zs"]}), encoding="utf-8"
    )
    monkeypatch.setattr(user_packs_store, "IMPORTED_PACKS_DIR", tmp_path / "packs-imported")

    z = user_packs_store.export_pack_zip("vendor-z")
    assert z
    shutil.rmtree(src)
    entry = user_packs_store.import_pack_zip(z)
    assert entry["id"] == "vendor-z"
    assert (tmp_path / "packs-imported" / "vendor-z" / "skills" / "zs" / "SKILL.md").is_file()
```

- [ ] **Step 2: 运行确认失败**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py::test_export_import_roundtrip -v`
Expected: FAIL（`export_pack_zip` 不存在）。

- [ ] **Step 3: 实现**

```python
def export_pack_zip(pack_id: str) -> bytes:
    pid = str(pack_id or "").strip()
    pack_dir, _ = _resolve_pack_dir(pid)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(pack_dir.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                zf.write(path, path.relative_to(pack_dir).as_posix())
    return buf.getvalue()
```

- [ ] **Step 4: 运行确认通过**

Run: `cd backend && python -m pytest tests/test_user_packs_store.py::test_export_import_roundtrip -v`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add backend/user_packs_store.py backend/tests/test_user_packs_store.py
git commit -m "feat(packs): export_pack_zip 打包分享"
```

---

### Task 7: Server 路由（import / remove imported / export）

**Files:**
- Modify: `backend/server.py`（import `UploadFile, File`，`Response`；三个路由）

**Interfaces:**
- Consumes: `require_loopback`、`import_pack_zip`、`remove_imported_pack`、`export_pack_zip`。
- Produces: `POST /api/user-skills/packs/import`、`DELETE /api/user-skills/packs/imported/{id}`、`GET /api/user-skills/packs/{id}/export`。

> 路由是 store 函数的薄包装；store 逻辑已被 Task 1–6 测试覆盖。`require_loopback` 会拦非本机请求，route 层自动化测试意义不大，改用手动验证。

- [ ] **Step 1: 改 import**

`backend/server.py` 顶部：
```python
from fastapi import FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse, Response, StreamingResponse
```
（在现有 `from fastapi import FastAPI, HTTPException, Request` 行上扩展；`Response` 加到 `fastapi.responses` import 行。）

- [ ] **Step 2: 实现路由**

在 `GET /api/user-skills/packs`（`server.py:408-410`）之后追加：

```python
@app.post("/api/user-skills/packs/import")
async def api_import_pack(request: Request, file: UploadFile = File(...)):
    require_loopback(request)
    data = await file.read()
    try:
        entry = import_pack_zip(data)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"pack": entry}


@app.delete("/api/user-skills/packs/imported/{pack_id}")
async def api_remove_imported_pack(pack_id: str, request: Request):
    require_loopback(request)
    try:
        result = remove_imported_pack(pack_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"pack": result}


@app.get("/api/user-skills/packs/{pack_id}/export")
async def api_export_pack(pack_id: str, request: Request):
    require_loopback(request)
    try:
        data = export_pack_zip(pack_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{pack_id}.zip"'},
    )
```

确认 `server.py` 已 import `import_pack_zip, remove_imported_pack, export_pack_zip`（在现有 `from user_packs_store import ...` 行补上）。

- [ ] **Step 3: 语法/导入检查**

Run: `cd backend && python -c "import server"`
Expected: 无 import/syntax 错误。

- [ ] **Step 4: 提交**

```bash
git add backend/server.py
git commit -m "feat(server): packs import/export/remove-imported 路由"
```

---

### Task 8: 前端 service（`Pack.source` + import/export/remove 函数）

**Files:**
- Modify: `addin/src/services/user-skills.ts`

**Interfaces:**
- Consumes: 现有 `API`、`PackSkill`、`PackExtension` 类型。
- Produces: `Pack` 增加 `source: string`；`importPackZip(file: File): Promise<Pack>`、`removeImportedPack(id): Promise<void>`、`exportPack(id): Promise<void>`。

- [ ] **Step 1: 改类型**

`Pack` 接口加 `source: string;`（`user-skills.ts:31-44`）。

- [ ] **Step 2: `fetchPacks` 解析 source**

`fetchPacks` 里 `out.push({ id, category, ... })` 对象加 `source: String((p as Pack).source || "official"),`。

- [ ] **Step 3: 新增三个函数**

在 `user-skills.ts`（`uninstallPack` 之后）追加：

```ts
export async function importPackZip(file: File): Promise<Pack> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(API + "/packs/import", { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "导入失败";
    throw new Error(detail);
  }
  const p = (data && typeof data === "object" ? (data as { pack?: unknown }).pack : null) || {};
  return {
    id: String((p as Pack).id || ""),
    source: String((p as Pack).source || "third-party"),
    category: String((p as Pack).category || ""),
    categoryLabel: String((p as Pack).categoryLabel || "第三方"),
    title: String((p as Pack).title || ""),
    description: String((p as Pack).description || ""),
    version: String((p as Pack).version || ""),
    gate: String((p as Pack).gate || ""),
    skills: Array.isArray((p as Pack).skills) ? ((p as Pack).skills as PackSkill[]) : [],
    knowledge: Array.isArray((p as Pack).knowledge) ? ((p as Pack).knowledge as string[]) : [],
    extensions: Array.isArray((p as Pack).extensions) ? ((p as Pack).extensions as PackExtension[]) : [],
    deps: (p as Pack).deps && typeof (p as Pack).deps === "object" ? ((p as Pack).deps as Record<string, unknown>) : {},
    installed: false,
  };
}

export async function removeImportedPack(id: string): Promise<void> {
  const r = await fetch(API + "/packs/imported/" + encodeURIComponent(id), { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error("删除来源失败");
}

export async function exportPack(id: string): Promise<void> {
  const r = await fetch(API + "/packs/" + encodeURIComponent(id) + "/export");
  if (!r.ok) return;
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = id + ".zip";
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: 类型检查**

Run: `cd addin && npm run typecheck`
Expected: PASS（无未用变量/类型错误）。

- [ ] **Step 5: 提交**

```bash
git add addin/src/services/user-skills.ts
git commit -m "feat(addin): user-skills 支持 pack 导入/导出/删来源"
```

---

### Task 9: PackMenu UI（导入按钮 + 第三方徽标 + 删来源 + 导出）

**Files:**
- Modify: `addin/src/taskpane/components/PackMenu.tsx`
- Modify: `addin/src/taskpane/taskpane.css`

**Interfaces:**
- Consumes: `Pack`（含 `source`）、`importPackZip`/`removeImportedPack`/`exportPack` 或经 props 传入的回调。
- Produces: props 增 `onImportPack?: (file: File) => Promise<void>`、`onRemoveImportedPack?: (id: string) => Promise<void>`。

- [ ] **Step 1: props + state**

`PackMenu.tsx`：`Props` 加 `onImportPack`、`onRemoveImportedPack`；解构时取出。加 state：
```ts
const [importBusy, setImportBusy] = useState(false);
const [importErr, setImportErr] = useState("");
const importInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: 导入按钮 + 隐藏 file input**

在 `flyout-head`（`<span>安装</span>` 之后、关闭按钮之前）插入：

```tsx
<button
  type="button"
  className="sample-btn ghost"
  disabled={importBusy}
  onClick={() => importInputRef.current?.click()}
  title="导入 Pack (zip)"
>
  {importBusy ? "导入中…" : "导入"}
</button>
<input
  ref={importInputRef}
  type="file"
  accept=".zip,application/zip"
  className="pack-csv-input-hidden"
  onChange={async (e) => {
    const f = e.target.files?.[0];
    if (!f || !onImportPack) return;
    setImportErr("");
    setImportBusy(true);
    try {
      await onImportPack(f);
    } catch (err) {
      setImportErr(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
      e.target.value = "";
    }
  }}
/>
```

- [ ] **Step 3: 第三方徽标 + 删来源 + 导出按钮**

在 pack 卡片 JSX（`.pack-card-title` 所在 `<div>` 内）标题后加徽标：
```tsx
{p.source === "third-party" && <span className="pack-badge">第三方</span>}
```
在卸载按钮之后、`FINANCE_PACK_ID` 的 CSV 区之前，加：
```tsx
{p.source === "third-party" && !p.installed && onRemoveImportedPack && (
  <button
    type="button"
    className="sample-btn ghost"
    onClick={() => {
      setPackErr("");
      void onRemoveImportedPack(p.id).catch((err) =>
        setPackErr(err instanceof Error ? err.message : String(err))
      );
    }}
  >
    删除来源
  </button>
)}
<button
  type="button"
  className="sample-btn ghost"
  onClick={() => void exportPack(p.id)}
>
  导出
</button>
```
（在文件顶部 import `exportPack` from `../../services/user-skills`。）

在错误行附近加导入错误显示：`{importErr && <p className="pack-menu-err">{importErr}</p>}`。

- [ ] **Step 4: CSS 徽标**

`addin/src/taskpane/taskpane.css` 追加：
```css
.pack-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 999px;
  background: var(--fx-fill, #fdf3d8);
  color: var(--fx, #d97706);
  border: 1px solid var(--fx-hover, #b45309);
}
```

- [ ] **Step 5: 类型检查 + 单测 + 构建**

Run: `cd addin && npm run typecheck && npm run test:unit && npm run build`
Expected: 全通过。

- [ ] **Step 6: 提交**

```bash
git add addin/src/taskpane/components/PackMenu.tsx addin/src/taskpane/taskpane.css
git commit -m "feat(addin): PackMenu 支持导入/徽标/删来源/导出"
```

---

### Task 10: App 接线（导入/删来源处理器）

**Files:**
- Modify: `addin/src/taskpane/components/App.tsx`

**Interfaces:**
- Consumes: `importPackZip`、`removeImportedPack`（`user-skills.ts`）。
- Produces: `handleImportPack(file)`、`handleRemoveImportedPack(id)`，传给 `<PackMenu>`。

- [ ] **Step 1: import + 处理器**

`App.tsx` import 行（`user-skills.ts`）加 `importPackZip, removeImportedPack`。在 `handleUninstallSample` 之后加：

```ts
const handleImportPack = useCallback(async (file: File) => {
  await importPackZip(file);
  const fresh = await fetchPacks();
  setPacks(fresh);
}, []);

const handleRemoveImportedPack = useCallback(async (id: string) => {
  await removeImportedPack(id);
  const fresh = await fetchPacks();
  setPacks(fresh);
}, []);
```

- [ ] **Step 2: 传给 PackMenu**

`<PackMenu ...>` 加 `onImportPack={handleImportPack}`、`onRemoveImportedPack={handleRemoveImportedPack}`。

- [ ] **Step 3: 类型检查 + 单测 + 构建**

Run: `cd addin && npm run typecheck && npm run test:unit && npm run build`
Expected: 全通过。

- [ ] **Step 4: 提交**

```bash
git add addin/src/taskpane/components/App.tsx
git commit -m "feat(addin): App 接线 pack 导入/删来源"
```

---

## 自审（Self-Review）

**Spec 覆盖：**
- 目录分离（IMPORTED vs RUNTIME）→ Task 1。
- list 合并 + source 标记 + categoryLabel 分叉 → Task 1。
- install source 感知 + taxonomy 仅官方 → Task 2。
- record 增 source/skills → Task 2。
- uninstall 从 record 读 skills → Task 3。
- import zip（slip/限制/id 冲突）→ Task 4。
- remove imported → Task 5。
- export zip → Task 6。
- server 路由 → Task 7。
- 前端 service 函数 → Task 8。
- PackMenu UI（导入/徽标/删源/导出）→ Task 9。
- App 接线 → Task 10。
- 测试与验证 → 各任务 + 下方「验证」。

**占位符扫描：** 无 TBD/TODO；每个代码步骤都给出实际代码。

**类型一致性：** `_resolve_pack_dir`/`_catalog_entry`/`import_pack_zip`/`remove_imported_pack`/`export_pack_zip`/`handleImportPack`/`handleRemoveImportedPack`/`importPackZip`/`removeImportedPack`/`exportPack` 在产生与消费处签名一致。

## 验证

1. `cd backend && python -m pytest tests -q` → 全绿（含 pytest-asyncio）。
2. `cd addin && npm run typecheck && npm run test:unit && npm run build` → 全绿。
3. 手动端到端：
   - 启动后端 → 任务窗格打开「安装」flyout → 点「导入」选一个 `{vendor}-{pack}.zip` → 列表出现带「第三方」徽标的包 → 安装（含 extensions 时弹 consent）→ `/` 列表可用 → 卸载 → 「删除来源」。
   - 作者端：对任一 pack 卡点「导出」→ 下载 zip → 改名后导入 → 出现副本。
4. 安全抽查：`python -c "from user_packs_store import import_pack_zip; import_pack_zip(open('evil.zip','rb').read())"` 对含 `../` 的 zip 抛 `ValueError`。
