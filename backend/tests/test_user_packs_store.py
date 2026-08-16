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


def test_install_pack_installs_skill(tmp_path, monkeypatch):
    # Redirect user skill dir (install_skill's module global) + installed_packs file
    # to tmp so we don't touch real config.
    import user_skills_store
    import user_packs_store

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    result = install_pack("cross-border-ecommerce")
    assert result["packId"] == "cross-border-ecommerce"
    assert result["skills"], "应安装至少一个技能"
    assert any(s["id"] == "amazon-research" for s in result["skills"])

    # Skill actually landed on disk via install_skill.
    md = tmp_path / "skills" / "amazon-research" / "SKILL.md"
    assert md.is_file(), "SKILL.md 应被 install_skill 写入"
    # Installed pack recorded in tmp, not real config.
    assert (tmp_path / "installed_packs.json").is_file()


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

    # Break the amazon-research SKILL.md so install_skill fails after the catalog read.
    skill_md = ROOT / "samples" / "packs" / "cross-border-ecommerce" / "skills" / "amazon-research" / "SKILL.md"
    original = skill_md.read_text(encoding="utf-8")
    skill_md.write_text("not a skill at all", encoding="utf-8")
    try:
        with pytest.raises(ValueError):
            install_pack("cross-border-ecommerce")
    finally:
        skill_md.write_text(original, encoding="utf-8")

    # No skill dir left behind from the failed pack.
    assert not (tmp_path / "skills" / "amazon-research").exists()
