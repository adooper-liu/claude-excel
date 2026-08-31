"""Skill registry — every addin manifest tool must have an executor, or startup fails.

Tree: addin/skills/core/*/manifest.json
Executor: addin/src/services/skill-handlers.ts (names in ADDIN_HANDLERS / HANDLED_TOOLS)

See skills/README.md.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any


class SkillRegistryError(Exception):
    """Raised when a manifest tool has no registered executor."""

    def __init__(self, missing: list[str], detail: str = ""):
        self.missing = missing
        msg = "Skill manifest has tools without executor (startup aborted)"
        if missing:
            msg += ": " + ", ".join(missing)
        if detail:
            msg += f" ({detail})"
        super().__init__(msg)


def addin_skills_dir(root: Path) -> Path:
    return root / "addin" / "skills" / "core"


def load_tools(skills_core: Path) -> list[dict]:
    """Return tool objects from every */manifest.json under skills_core."""
    if not skills_core.exists():
        raise SkillRegistryError([], detail=f"missing directory {skills_core}")
    tools: list[dict] = []
    for mf in sorted(skills_core.glob("*/manifest.json")):
        data = json.loads(mf.read_text(encoding="utf-8"))
        for tool in data.get("tools", []):
            name = tool.get("name")
            if not name:
                raise SkillRegistryError([], detail=f"{mf} has a tool without name")
            tools.append(tool)
    return tools


def load_tool_names(skills_core: Path) -> list[str]:
    return [t["name"] for t in load_tools(skills_core)]


def missing_executors(
    tool_names: Iterable[str],
    executors: Mapping[str, Any],
) -> list[str]:
    return sorted({n for n in tool_names if n not in executors})


def validate(skills_core: Path, executors: Mapping[str, Any]) -> None:
    missing = missing_executors(load_tool_names(skills_core), executors)
    if missing:
        raise SkillRegistryError(missing)


# Must stay in lockstep with addin/src/services/skill-handlers.ts switch cases
# and addin/src/services/skill-registry.ts HANDLED_TOOLS.
ADDIN_HANDLERS: dict[str, str] = {
    "read_selection": "skill-handlers.ts",
    "read_range": "skill-handlers.ts",
    "extract_selection": "skill-handlers.ts",
    "write_to_sheet": "skill-handlers.ts",
    "write_to_range": "skill-handlers.ts",
    "get_sheet_names": "skill-handlers.ts",
    "write_formula": "skill-handlers.ts",
    "format_range": "skill-handlers.ts",
    "conditional_format": "skill-handlers.ts",
    "data_validation": "skill-handlers.ts",
    "create_chart": "skill-handlers.ts",
    "sort_filter": "skill-handlers.ts",
    "fill_range": "skill-handlers.ts",
    "find_replace": "skill-handlers.ts",
    "set_active_sheet": "skill-handlers.ts",
    "inspect_workbook": "skill-handlers.ts",
    "inspect_table": "skill-handlers.ts",
    "inspect_formulas": "skill-handlers.ts",
    "scan_formula_errors": "skill-handlers.ts",
    "ensure_table": "skill-handlers.ts",
    "reconcile_tables": "skill-handlers.ts",
    "reshape_table": "skill-handlers.ts",
    "calculate_table": "skill-handlers.ts",
    "create_pivot": "skill-handlers.ts",
    "build_dashboard": "skill-handlers.ts",
    "write_inputs": "skill-handlers.ts",
    "web_fetch": "skill-handlers.ts",
    "search_knowledge": "skill-handlers.ts",
    "run_flow": "skill-handlers.ts",
    "interpret_document": "skill-handlers.ts",
    "propose_recipe": "skill-handlers.ts",
    "complete": "skill-handlers.ts",
    "save_structure_note": "skill-handlers.ts",
    "load_structure_notes": "skill-handlers.ts",
    "append_pack_audit": "skill-handlers.ts",
}


def validate_backend_skills(root: Path) -> None:
    """Fail process startup if any declared add-in tool lacks an executor."""
    validate(addin_skills_dir(root), ADDIN_HANDLERS)
