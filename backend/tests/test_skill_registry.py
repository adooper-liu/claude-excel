"""Skill registry: every manifest tool must have an executor, or startup fails."""

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from skill_registry import (  # noqa: E402
    SkillRegistryError,
    load_tool_names,
    missing_executors,
    validate,
)


def _write_manifest(dir: Path, tools: list[str]) -> None:
    skill = dir / "demo"
    skill.mkdir()
    (skill / "manifest.json").write_text(
        json.dumps({
            "name": "demo",
            "tools": [
                {
                    "name": n,
                    "description": n,
                    "input_schema": {"type": "object", "properties": {}},
                }
                for n in tools
            ],
        }),
        encoding="utf-8",
    )


def test_missing_executor_raises(tmp_path: Path):
    _write_manifest(tmp_path, ["has_handler", "no_handler"])
    with pytest.raises(SkillRegistryError) as ei:
        validate(tmp_path, {"has_handler": lambda: None})
    assert ei.value.missing == ["no_handler"]


def test_all_tools_registered_passes(tmp_path: Path):
    _write_manifest(tmp_path, ["a", "b"])
    validate(tmp_path, {"a": lambda: None, "b": lambda: None})


def test_load_tool_names_reads_nested_manifests(tmp_path: Path):
    _write_manifest(tmp_path, ["t1"])
    assert load_tool_names(tmp_path) == ["t1"]


def test_missing_executors_sorted():
    assert missing_executors(["z", "a"], {"z": 1}) == ["a"]


def test_repo_addin_skills_all_have_executors():
    from skill_registry import ADDIN_HANDLERS, addin_skills_dir, validate_backend_skills

    validate_backend_skills(ROOT)
    names = load_tool_names(addin_skills_dir(ROOT))
    assert names, "addin/skills/core should declare tools"
    assert missing_executors(names, ADDIN_HANDLERS) == []


def test_addin_handled_tools_match_python_and_manifests():
    import re
    from skill_registry import ADDIN_HANDLERS

    text = (ROOT / "addin" / "src" / "services" / "skill-registry.ts").read_text(encoding="utf-8")
    block = text.split("new Set([", 1)[1].split("])", 1)[0]
    ts_names = set(re.findall(r'"([a-z0-9_]+)"', block))
    manifest_names = set(load_tool_names(ROOT / "addin" / "skills" / "core"))
    assert ts_names == set(ADDIN_HANDLERS) == manifest_names
