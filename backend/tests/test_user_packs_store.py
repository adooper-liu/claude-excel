"""Packs: list/install sample packs reuses install_skill; no new executors."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from user_packs_store import (  # noqa: E402
    TAXONOMY_FILE,
    category_label,
    install_pack,
    list_packs,
    load_taxonomy,
    uninstall_pack,
)


def test_taxonomy_exists_and_has_categories():
    assert TAXONOMY_FILE.is_file(), "samples/taxonomy.json 必须存在"
    cats = load_taxonomy()
    assert cats, "taxonomy.json 应有 categories"
    ids = {c["id"] for c in cats}
    assert "cross-border-ecommerce" in ids


def test_category_label_known_and_unknown():
    assert category_label("cross-border-ecommerce") == "跨境电商"
    assert category_label("no-such-cat") == "no-such-cat"


def test_list_packs_lists_cross_border_ecommerce():
    packs = list_packs()
    assert packs, "samples/packs/ 下应有 pack"
    p = next((x for x in packs if x["id"] == "cross-border-ecommerce"), None)
    assert p is not None
    assert p["category"] == "cross-border-ecommerce"
    assert p["categoryLabel"] == "跨境电商"
    assert any(s["id"] == "amazon-research" for s in p["skills"]), "pack.skills 应含 amazon-research"
    assert p["knowledge"] == ["serp-appendix.md"], "pack.knowledge 应含 serp-appendix.md"
    assert p["deps"].get("recipes") == ["amazon.com"], "pack.deps.recipes 应声明 amazon.com"
    assert any(e["name"] == "user.profit_assumptions" for e in p.get("extensions") or []), (
        "pack.extensions 应含 user.profit_assumptions"
    )


def test_install_pack_installs_skill(tmp_path, monkeypatch):
    # Redirect user skill dir (install_skill's module global) + installed_packs file
    # to tmp so we don't touch real config.
    import user_skills_store
    import user_packs_store
    import user_extension_registry

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    result = install_pack("cross-border-ecommerce", consent_extensions=True)
    assert result["packId"] == "cross-border-ecommerce"
    assert result["skills"], "应安装至少一个技能"
    assert any(s["id"] == "amazon-research" for s in result["skills"])
    assert any(e["name"] == "user.profit_assumptions" for e in result.get("extensions") or [])

    # Skill actually landed on disk via install_skill.
    md = tmp_path / "skills" / "amazon-research" / "SKILL.md"
    assert md.is_file(), "SKILL.md 应被 install_skill 写入"
    ext_manifest = tmp_path / "packs" / "cross-border-ecommerce" / "extensions" / "profit-assumptions" / "manifest.json"
    assert ext_manifest.is_file(), "扩展 manifest 应复制到 runtime packs"
    # Installed pack recorded in tmp, not real config.
    assert (tmp_path / "installed_packs.json").is_file()
    rec = json.loads((tmp_path / "installed_packs.json").read_text(encoding="utf-8"))
    assert rec[0].get("capabilityHash"), "含 extensions 的 pack 应记录 capabilityHash"


def test_install_pack_unknown_id_raises(tmp_path, monkeypatch):
    import user_packs_store

    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    with pytest.raises(ValueError, match="示例包不存在"):
        install_pack("no-such-pack")


def test_install_pack_rolls_back_on_failure(tmp_path, monkeypatch):
    import user_skills_store
    import user_packs_store

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    real_read_text = Path.read_text

    def broken_read_text(self, encoding="utf-8"):
        if self.name == "SKILL.md" and "amazon-research" in str(self):
            return "not a skill at all"
        return real_read_text(self, encoding=encoding)

    monkeypatch.setattr(Path, "read_text", broken_read_text)

    with pytest.raises(ValueError):
        install_pack("cross-border-ecommerce", consent_extensions=True)

    assert not (tmp_path / "skills" / "amazon-research").exists()


def test_install_pack_requires_consent_for_extensions(tmp_path, monkeypatch):
    import user_skills_store
    import user_packs_store
    import user_extension_registry

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    with pytest.raises(ValueError, match="需要用户同意"):
        install_pack("cross-border-ecommerce", consent_extensions=False)

    with pytest.raises(ValueError, match="需要用户同意"):
        install_pack("cross-border-ecommerce")

    result = install_pack("cross-border-ecommerce", consent_extensions=True)
    assert result["extensions"]


def test_install_pack_rejects_skills_manifest_mismatch(tmp_path, monkeypatch):
    import user_packs_store

    pack_root = tmp_path / "packs" / "bad-pack"
    (pack_root / "skills" / "only-one").mkdir(parents=True)
    (pack_root / "skills" / "only-one" / "SKILL.md").write_text(
        """---
name: only-one
description: one skill
slash: 一
---
# one
""",
        encoding="utf-8",
    )
    (pack_root / "pack.json").write_text(
        json.dumps(
            {
                "id": "bad-pack",
                "category": "cross-border-ecommerce",
                "title": "bad",
                "skills": ["only-one", "missing"],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(user_packs_store, "PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    with pytest.raises(ValueError, match="skills 与 skills/ 目录不一致"):
        install_pack("bad-pack")


def test_uninstall_pack_removes_skill_extensions_record(tmp_path, monkeypatch):
    import user_skills_store
    import user_packs_store
    import user_extension_registry

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    install_pack("cross-border-ecommerce", consent_extensions=True)
    result = uninstall_pack("cross-border-ecommerce")
    assert result["packId"] == "cross-border-ecommerce"

    assert not (tmp_path / "skills" / "amazon-research").exists()
    assert not (tmp_path / "packs" / "cross-border-ecommerce").exists()
    rec = json.loads((tmp_path / "installed_packs.json").read_text(encoding="utf-8"))
    assert rec == []


def test_uninstall_pack_unknown_id_raises(tmp_path, monkeypatch):
    import user_packs_store

    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    with pytest.raises(ValueError, match="未安装"):
        uninstall_pack("no-such-pack")
