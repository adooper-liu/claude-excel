"""Load site/sheet recipe templates from recipe/hosts/*.yml (engine data, not picker selectors)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:  # pragma: no cover
    yaml = None  # type: ignore

REPO_ROOT = Path(__file__).resolve().parents[1]
HOSTS_DIR = REPO_ROOT / "recipe" / "hosts"
SHEETS_DIR = REPO_ROOT / "recipe" / "sheets"


def _read_yaml(path: Path) -> dict[str, Any]:
    raw = path.read_text(encoding="utf-8")
    if yaml is not None:
        data = yaml.safe_load(raw)
    else:
        # Dev fallback when PyYAML missing: only .json sidecars
        sidecar = path.with_suffix(".json")
        if sidecar.is_file():
            data = json.loads(sidecar.read_text(encoding="utf-8"))
        else:
            raise RuntimeError("PyYAML required to load " + str(path))
    if not isinstance(data, dict):
        raise ValueError("invalid template: " + str(path))
    return data


def load_host_templates() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not HOSTS_DIR.is_dir():
        return out
    for path in sorted(HOSTS_DIR.glob("*.yml")):
        data = _read_yaml(path)
        host = str(data.pop("host", "") or path.stem).strip()
        if not host:
            continue
        out[host] = data
    return out


def load_sheet_templates() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    if not SHEETS_DIR.is_dir():
        return out
    for path in sorted(SHEETS_DIR.glob("*.yml")):
        data = _read_yaml(path)
        key = str(data.pop("key", "") or path.stem).strip()
        if not key:
            continue
        out[key] = data
    return out
