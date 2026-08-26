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

def _backup_zip(manifest=None, extra=None):
    entries = {
        "manifest.json": json.dumps(
            manifest or {"format": "sheetwise-backup", "version": 1, "createdAt": "t", "contents": ["skills"]}
        )
    }
    entries.update(extra or {})
    return _make_zip(entries)


def test_preview_backup_valid(tmp_path, monkeypatch):
    z = _backup_zip(extra={
        "skills/a/SKILL.md": "---\nname: a\ndescription: A\nslash: A\n---\n# a\n",
        "config/provider-skeleton.json": json.dumps(
            {"activeProvider": "deepseek", "providers": {"deepseek": {"baseUrl": "u", "model": "m"}}}
        ),
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
        backup_store.preview_backup(
            _backup_zip(manifest={"format": "sheetwise-backup", "version": 99, "contents": []})
        )


def test_preview_needs_consent_when_pack_has_extensions(tmp_path, monkeypatch):
    z = _backup_zip(extra={
        "installed-packs.json": json.dumps([{"id": "vendor-p", "source": "third-party"}]),
        "packs/vendor-p/pack.json": json.dumps({"id": "vendor-p", "skills": []}),
        "packs/vendor-p/extensions/demo/manifest.json": json.dumps(
            {"name": "user.demo_fn", "description": "d", "entry": "handler.py", "network": False, "secrets": [], "timeoutMs": 5000}
        ),
    })
    prev = backup_store.preview_backup(z)
    assert prev["needsConsent"] is True
    assert any(p["id"] == "vendor-p" and p["hasExtensions"] for p in prev["contents"]["packs"])

def _install_vendor_pack(tmp_path, monkeypatch):
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
        "config/provider-skeleton.json": json.dumps(
            {"activeProvider": "qwen", "providers": {"qwen": {"baseUrl": "https://dashscope", "model": "qm", "smallFastModel": ""}}}
        ),
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
        "packs/vendor-logistics/pack.json": json.dumps(
            {"id": "vendor-logistics", "category": "自定义物流", "title": "物流", "skills": ["logistics-check"]}
        ),
        "packs/vendor-logistics/skills/logistics-check/SKILL.md": "---\nname: logistics-check\ndescription: 物流检查\nslash: 物流检查\n---\n# check\n",
    })
    result = asyncio.run(backup_store.apply_backup(z, consent_extensions=False))
    assert "vendor-logistics" in result["restored"]["packs"]
    assert (tmp_path / "packs-imported" / "vendor-logistics" / "pack.json").is_file()


def test_apply_extension_pack_needs_consent_flag(tmp_path, monkeypatch):
    _patch_data_dirs(tmp_path, monkeypatch)
    z = _backup_zip(extra={
        "installed-packs.json": json.dumps([{"id": "vendor-ext", "source": "third-party"}]),
        "packs/vendor-ext/pack.json": json.dumps(
            {"id": "vendor-ext", "category": "自定义", "title": "Ext", "skills": [], "extensions": ["demo"]}
        ),
        "packs/vendor-ext/extensions/demo/manifest.json": json.dumps(
            {"name": "user.demo_fn", "description": "d", "entry": "handler.py", "network": False, "secrets": [], "timeoutMs": 5000}
        ),
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
        {
            "activeProvider": "deepseek",
            "providers": {"deepseek": {"apiKey": "existing-key", "baseUrl": "old", "model": "", "smallFastModel": ""}},
        },
    )
    z = _backup_zip(extra={
        "config/provider-skeleton.json": json.dumps(
            {"activeProvider": "deepseek", "providers": {"deepseek": {"baseUrl": "new-url", "model": "m", "smallFastModel": ""}}}
        ),
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
