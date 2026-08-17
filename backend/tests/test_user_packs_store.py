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


def test_list_packs_lists_split_cross_border_packs():
    packs = list_packs()
    assert packs, "samples/packs/ 下应有 pack"
    research = next((x for x in packs if x["id"] == "cross-border-ecommerce-research"), None)
    finance = next((x for x in packs if x["id"] == "cross-border-ecommerce-finance"), None)
    assert research is not None
    assert finance is not None
    assert research["category"] == "cross-border-ecommerce"
    assert finance["category"] == "cross-border-ecommerce"
    assert any(s["id"] == "amazon-research" for s in research["skills"])
    assert not research.get("extensions"), "选品包不应含 user.*"
    assert research["deps"].get("recipes") == ["amazon.com"]
    assert any(s["id"] == "finance-reconciliation" for s in finance["skills"])
    assert any(e["name"] == "user.connector_load_feed" for e in finance.get("extensions") or [])
    assert "platform_fields.md" in finance["knowledge"]
    assert next((x for x in packs if x["id"] == "cross-border-ecommerce"), None) is None, (
        "旧合一 pack id 应已移除"
    )


def test_install_research_pack_no_consent_required(tmp_path, monkeypatch):
    import user_skills_store
    import user_packs_store

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")

    result = install_pack("cross-border-ecommerce-research")
    assert result["packId"] == "cross-border-ecommerce-research"
    assert any(s["id"] == "amazon-research" for s in result["skills"])
    assert not result.get("extensions")
    assert (tmp_path / "skills" / "amazon-research" / "SKILL.md").is_file()


def test_install_finance_pack_installs_skill(tmp_path, monkeypatch):
    import user_skills_store
    import user_packs_store
    import user_extension_registry

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    result = install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    assert result["packId"] == "cross-border-ecommerce-finance"
    assert any(s["id"] == "finance-reconciliation" for s in result["skills"])
    assert any(e["name"] == "user.profit_assumptions" for e in result.get("extensions") or [])
    assert any(e["name"] == "user.connector_load_feed" for e in result.get("extensions") or [])

    assert (tmp_path / "skills" / "finance-reconciliation" / "SKILL.md").is_file()
    connector_fixture = (
        tmp_path / "packs" / "cross-border-ecommerce-finance" / "connector" / "fixtures" / "orders.csv"
    )
    assert connector_fixture.is_file(), "connector/fixtures 应复制到 runtime packs"
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
        install_pack("cross-border-ecommerce-research")

    assert not (tmp_path / "skills" / "amazon-research").exists()


def test_install_finance_pack_requires_consent_for_extensions(tmp_path, monkeypatch):
    import user_skills_store
    import user_packs_store
    import user_extension_registry

    monkeypatch.setattr(user_skills_store, "SKILLS_DIR", tmp_path / "skills")
    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    monkeypatch.setattr(user_packs_store, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "RUNTIME_PACKS_DIR", tmp_path / "packs")
    monkeypatch.setattr(user_extension_registry, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")

    with pytest.raises(ValueError, match="需要用户同意"):
        install_pack("cross-border-ecommerce-finance", consent_extensions=False)

    with pytest.raises(ValueError, match="需要用户同意"):
        install_pack("cross-border-ecommerce-finance")

    result = install_pack("cross-border-ecommerce-finance", consent_extensions=True)
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

    install_pack("cross-border-ecommerce-finance", consent_extensions=True)
    result = uninstall_pack("cross-border-ecommerce-finance")
    assert result["packId"] == "cross-border-ecommerce-finance"

    assert not (tmp_path / "skills" / "finance-reconciliation").exists()
    assert not (tmp_path / "packs" / "cross-border-ecommerce-finance").exists()
    rec = json.loads((tmp_path / "installed_packs.json").read_text(encoding="utf-8"))
    assert rec == []


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


def test_uninstall_pack_unknown_id_raises(tmp_path, monkeypatch):
    import user_packs_store

    monkeypatch.setattr(user_packs_store, "INSTALLED_PACKS_FILE", tmp_path / "installed_packs.json")
    with pytest.raises(ValueError, match="未安装"):
        uninstall_pack("no-such-pack")


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
