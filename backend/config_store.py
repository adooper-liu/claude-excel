"""config_store.py — Persist provider config to ~/.claude-excel-web/config.json"""

import json
import os
from pathlib import Path

CONFIG_DIR = Path.home() / ".claude-excel-web"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_CONFIG = {
    "apiKey": "",
    "baseUrl": "https://api.deepseek.com/anthropic",
    "model": "deepseek-v4-pro[1m]",
    "smallFastModel": "deepseek-v4-flash",
    "embeddingModel": "",
}

_config: dict = {}


def _ensure_dir():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    global _config
    _ensure_dir()
    try:
        if CONFIG_FILE.exists():
            _config = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pass
    # Merge with defaults for missing keys
    for k, v in DEFAULT_CONFIG.items():
        _config.setdefault(k, v)
    return _config


def save_config(data: dict):
    global _config
    _config.update(data)
    _ensure_dir()
    CONFIG_FILE.write_text(
        json.dumps({**_config, "updatedAt": str(__import__("datetime").datetime.now())},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def get_config() -> dict:
    if not _config:
        load_config()
    return dict(_config)


def get_api_key() -> str:
    env_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or ""
    if env_key:
        return env_key
    return get_config().get("apiKey", "")


def get_base_url() -> str:
    env_url = os.getenv("DEEPSEEK_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL") or ""
    if env_url:
        return env_url
    return get_config().get("baseUrl", DEFAULT_CONFIG["baseUrl"])


def get_model() -> str:
    env_model = os.getenv("ANTHROPIC_MODEL") or ""
    if env_model:
        return env_model
    return get_config().get("model", DEFAULT_CONFIG["model"])


def get_small_fast_model() -> str:
    env_model = os.getenv("ANTHROPIC_SMALL_FAST_MODEL") or ""
    if env_model:
        return env_model
    return get_config().get("smallFastModel", DEFAULT_CONFIG["smallFastModel"])


# Load on import
load_config()
