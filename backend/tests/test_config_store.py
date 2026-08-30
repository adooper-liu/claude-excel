"""Behavioral contract for provider config (apiStyle round-trip)."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import config_store  # noqa: E402


def test_save_provider_and_status_keep_api_style(monkeypatch):
    cfg = {"providers": {}}
    monkeypatch.setattr(config_store, "get_config", lambda: cfg)
    monkeypatch.setattr(config_store, "save_config", lambda _c: None)
    config_store.save_provider(
        "ollama",
        {"baseUrl": "http://localhost:11434", "model": "qwen2.5:7b", "apiStyle": "openai"},
    )
    status = config_store.get_provider_status()
    assert status["ollama"]["apiStyle"] == "openai"
    assert status["ollama"]["baseUrl"] == "http://localhost:11434"
