"""Extension-owned secrets (not in pack dir). Keyed by user.* function name."""

from __future__ import annotations

import json
import re
from pathlib import Path

from config_store import CONFIG_DIR

SECRETS_FILE = CONFIG_DIR / "extension-secrets.json"
_SECRET_KEY_RE = re.compile(r"^[a-z][a-z0-9_]*$")


def _load_all() -> dict[str, dict[str, str]]:
    if not SECRETS_FILE.is_file():
        return {}
    try:
        data = json.loads(SECRETS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, dict[str, str]] = {}
    for fn_name, secrets in data.items():
        if not isinstance(fn_name, str) or not isinstance(secrets, dict):
            continue
        cleaned: dict[str, str] = {}
        for k, v in secrets.items():
            if isinstance(k, str) and isinstance(v, str):
                cleaned[k] = v
        if cleaned:
            out[fn_name] = cleaned
    return out


def _write_all(data: dict[str, dict[str, str]]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    SECRETS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_secrets(fn_name: str, declared: list[str]) -> dict[str, str]:
    """Return CE_SECRET_* env values for declared secret keys only."""
    if not declared:
        return {}
    store = _load_all().get(fn_name) or {}
    out: dict[str, str] = {}
    for key in declared:
        if key not in store:
            continue
        env_key = "CE_SECRET_" + key.upper()
        out[env_key] = store[key]
    return out


def set_secret(fn_name: str, secret_key: str, value: str) -> None:
    key = str(secret_key or "").strip()
    if not _SECRET_KEY_RE.match(key):
        raise ValueError("secret key must match ^[a-z][a-z0-9_]*$")
    val = str(value or "")
    data = _load_all()
    entry = dict(data.get(fn_name) or {})
    if not val:
        entry.pop(key, None)
    else:
        entry[key] = val
    if entry:
        data[fn_name] = entry
    else:
        data.pop(fn_name, None)
    _write_all(data)
