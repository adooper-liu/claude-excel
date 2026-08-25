"""config_store.py — Persist provider config to ~/.claude-excel-web/config.json

多 provider 并存：每个 provider 各存一套 {apiKey, baseUrl, model, smallFastModel}，
`activeProvider` 标记当前生效的那个。旧版单套配置在 load 时自动迁移。
"""

import json
import os
from pathlib import Path

CONFIG_DIR = Path.home() / ".claude-excel-web"
CONFIG_FILE = CONFIG_DIR / "config.json"

DEFAULT_PROVIDERS = {
    "deepseek": {
        "apiKey": "",
        "baseUrl": "https://api.deepseek.com/anthropic",
        "model": "deepseek-v4-flash",
        "smallFastModel": "deepseek-v4-flash",
    },
    "qwen": {
        "apiKey": "",
        "baseUrl": "https://dashscope.aliyuncs.com/apps/anthropic",
        "model": "qwen3-coder-plus",
        "smallFastModel": "qwen-flash",
    },
    "glm": {
        "apiKey": "",
        "baseUrl": "https://open.bigmodel.cn/api/anthropic",
        "model": "glm-4.7",
        "smallFastModel": "glm-4.7",
    },
    "minimax": {
        "apiKey": "",
        "baseUrl": "https://api.minimax.chat/anthropic",
        "model": "minimax-m1",
        "smallFastModel": "minimax-m1",
    },
}

DEFAULT_CONFIG = {
    "activeProvider": "deepseek",
    "providers": DEFAULT_PROVIDERS,
    "embeddingModel": "",
}

_config: dict = {}


def _infer_provider_id(base_url: str) -> str:
    """旧版单套配置迁移用：由 baseUrl 推断 provider id。"""
    b = (base_url or "").lower()
    if "deepseek" in b:
        return "deepseek"
    if "dashscope" in b or "aliyun" in b:
        return "qwen"
    if "bigmodel" in b or "zhipu" in b:
        return "glm"
    if "minimax" in b:
        return "minimax"
    return "custom"


def _ensure_dir():
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)


def load_config() -> dict:
    global _config
    _ensure_dir()
    cfg = {}
    try:
        if CONFIG_FILE.exists():
            cfg = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        pass

    providers = cfg.get("providers")
    if not isinstance(providers, dict):
        # 迁移旧版单套 apiKey/baseUrl/model → providers[infer]
        providers = {pid: dict(p) for pid, p in DEFAULT_PROVIDERS.items()}
        pid = _infer_provider_id(cfg.get("baseUrl", ""))
        target = providers.setdefault(
            pid, {"apiKey": "", "baseUrl": "", "model": "", "smallFastModel": ""}
        )
        for k in ("apiKey", "baseUrl", "model", "smallFastModel"):
            if cfg.get(k):
                target[k] = cfg[k]
        cfg["providers"] = providers
        cfg["activeProvider"] = pid

    # 补齐默认 provider 与字段，保证 getters 永远有值
    for pid, pdef in DEFAULT_PROVIDERS.items():
        entry = providers.setdefault(pid, {})
        for k, v in pdef.items():
            entry.setdefault(k, v)

    cfg.setdefault("activeProvider", "deepseek")
    if cfg.get("activeProvider") not in providers:
        cfg["activeProvider"] = "deepseek"
    cfg.setdefault("embeddingModel", "")

    _config = cfg
    return _config


def get_config() -> dict:
    if not _config:
        load_config()
    return dict(_config)


def save_config(data: dict):
    global _config
    _config.update(data)
    _ensure_dir()
    CONFIG_FILE.write_text(
        json.dumps({**_config, "updatedAt": str(__import__("datetime").datetime.now())},
                   ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _active_provider() -> dict:
    cfg = get_config()
    pid = cfg.get("activeProvider", "deepseek")
    return cfg.get("providers", {}).get(pid, {})


def get_active_provider() -> str:
    return get_config().get("activeProvider", "deepseek")


def get_api_key() -> str:
    env_key = os.getenv("DEEPSEEK_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or ""
    if env_key:
        return env_key
    return _active_provider().get("apiKey", "")


def get_base_url() -> str:
    env_url = os.getenv("DEEPSEEK_BASE_URL") or os.getenv("ANTHROPIC_BASE_URL") or ""
    if env_url:
        return env_url
    return _active_provider().get("baseUrl", DEFAULT_PROVIDERS["deepseek"]["baseUrl"])


def get_model() -> str:
    env_model = os.getenv("ANTHROPIC_MODEL") or ""
    if env_model:
        return env_model
    return _active_provider().get("model", DEFAULT_PROVIDERS["deepseek"]["model"])


def get_small_fast_model() -> str:
    env_model = os.getenv("ANTHROPIC_SMALL_FAST_MODEL") or ""
    if env_model:
        return env_model
    return _active_provider().get("smallFastModel", DEFAULT_PROVIDERS["deepseek"]["smallFastModel"])


def save_provider(provider_id: str, data: dict):
    """保存某个 provider 的配置字段（apiKey/baseUrl/model/smallFastModel）。"""
    cfg = get_config()
    providers = cfg.setdefault("providers", {})
    entry = providers.setdefault(provider_id, {})
    for k in ("apiKey", "baseUrl", "model", "smallFastModel"):
        if data.get(k):
            entry[k] = data[k]
    save_config(cfg)


def set_active_provider(provider_id: str) -> bool:
    cfg = get_config()
    if provider_id not in cfg.get("providers", {}):
        return False
    cfg["activeProvider"] = provider_id
    save_config(cfg)
    return True


def get_provider_status() -> dict:
    """公开给前端的 provider 状态（不含 key）。"""
    cfg = get_config()
    out = {}
    for pid, p in cfg.get("providers", {}).items():
        out[pid] = {
            "hasKey": bool(p.get("apiKey")),
            "baseUrl": p.get("baseUrl", ""),
            "model": p.get("model", ""),
            "smallFastModel": p.get("smallFastModel", ""),
        }
    return out


# Load on import
load_config()
