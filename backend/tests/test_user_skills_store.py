"""Installed user skills as SKILL.md under ~/.claude-excel-web/skills/."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from user_skills_store import delete_skill, install_sample_skill, install_skill, list_sample_skills, list_skills, parse_skill_md  # noqa: E402


SAMPLE = """---
name: monthly-close
description: Month-end workbook checklist.
slash: 月结
---

# 月结
inspect_workbook first
"""


def test_parse_frontmatter():
    s = parse_skill_md(SAMPLE)
    assert s["id"] == "monthly-close"
    assert s["slash"] == "月结"
    assert "inspect_workbook" in s["body"]
    assert "name:" not in s["body"]


def test_install_roundtrip(tmp_path: Path):
    install_skill(tmp_path, SAMPLE)
    got = list_skills(tmp_path)
    assert len(got) == 1
    assert got[0]["slash"] == "月结"
    delete_skill(tmp_path, "monthly-close")
    assert list_skills(tmp_path) == []


def test_list_and_install_sample_skill(tmp_path: Path):
    samples = list_sample_skills()
    assert any(s["id"] == "amazon-research" for s in samples)
    skill = install_sample_skill("amazon-research", tmp_path)
    assert skill["slash"] == "亚马逊选品"
    assert "reshape_table" in skill["body"]
    assert list_skills(tmp_path)[0]["id"] == "amazon-research"


def test_install_sample_unknown(tmp_path: Path):
    try:
        install_sample_skill("no-such-pack", tmp_path)
        assert False, "should fail"
    except ValueError as e:
        assert "不存在" in str(e)


def test_rejects_builtin_name():
    raw = "---\nname: reconcile\ndescription: no\n---\nbody\n"
    try:
        parse_skill_md(raw)
        assert False, "should reject"
    except ValueError as e:
        assert "内置" in str(e)
