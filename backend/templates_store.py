"""User prompt templates in ~/.claude-excel-web/templates.json."""

import json
from pathlib import Path
from typing import Any

from config_store import CONFIG_DIR

TEMPLATES_FILE = CONFIG_DIR / "templates.json"


def _clean(items: Any) -> list[dict]:
    out: list[dict] = []
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        tid = str(item.get("id") or "").strip()
        title = str(item.get("title") or "").strip()
        prompt = str(item.get("prompt") or "").strip()
        if tid and title and prompt:
            out.append({"id": tid, "title": title, "prompt": prompt})
    return out[:40]


def read_templates(path: Path | None = None) -> list[dict]:
    file = path or TEMPLATES_FILE
    try:
        if not file.exists():
            return []
        data = json.loads(file.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return _clean(data)
        return _clean(data.get("templates"))
    except (json.JSONDecodeError, OSError):
        return []


def write_templates(path: Path | None, templates: list[dict]) -> list[dict]:
    file = path or TEMPLATES_FILE
    cleaned = _clean(templates)
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(
        json.dumps({"templates": cleaned}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return cleaned
