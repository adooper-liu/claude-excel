"""Behavioral contract for the AI proxy error mapping."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import ai_proxy  # noqa: E402


def test_rate_limit_error_is_friendly_and_keeps_reset_hint():
    body = (
        '{"type":"error","error":{"type":"rate_limit_error","code":"1310",'
        '"message":"您已达到每周/每月使用上限，您的限额将在 2026-09-04 04:04:07 重置。"}}'
    )
    text = ai_proxy._api_error_text(429, body)
    assert "限流" in text
    assert "2026-09-04" in text


def test_generic_error_keeps_body():
    text = ai_proxy._api_error_text(500, "boom")
    assert "500" in text
    assert "boom" in text


def test_error_extracts_json_message():
    text = ai_proxy._api_error_text(400, '{"error":{"message":"bad request"}}')
    assert "bad request" in text

import asyncio
import json

import ai_proxy  # noqa: E402


def test_is_openai_api_detects_ollama_and_style():
    assert ai_proxy._is_openai_api("http://localhost:11434") is True
    assert ai_proxy._is_openai_api("http://127.0.0.1:11434/v1") is True
    assert ai_proxy._is_openai_api("https://dashscope.aliyuncs.com/apps/anthropic") is False


def test_is_openai_api_uses_active_provider_style(monkeypatch):
    monkeypatch.setattr(ai_proxy, "get_active_provider", lambda: {"apiStyle": "openai"})
    assert ai_proxy._is_openai_api("https://any.example.com") is True


def test_headers_for_openai_omits_anthropic_headers():
    headers = ai_proxy._headers_for("http://localhost:11434", "")
    assert "x-api-key" not in headers
    assert "anthropic-version" not in headers
    bearer = ai_proxy._headers_for("http://localhost:11434", "k")
    assert bearer["Authorization"] == "Bearer k"
    anthropic = ai_proxy._headers_for("https://dashscope.aliyuncs.com/apps/anthropic", "k")
    assert anthropic["x-api-key"] == "k"
    assert "anthropic-version" in anthropic


def test_payload_openai_builds_system_message_and_tools():
    body = ai_proxy._payload_openai(
        [{"role": "user", "content": "hi"}],
        "sys",
        "qwen2.5:7b",
        100,
        [{"name": "run", "description": "d", "input_schema": {"type": "object"}}],
        False,
    )
    assert body["model"] == "qwen2.5:7b"
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert body["messages"][1] == {"role": "user", "content": "hi"}
    assert body["tools"][0]["type"] == "function"
    assert body["tools"][0]["function"]["name"] == "run"
    assert body["tools"][0]["function"]["parameters"] == {"type": "object"}


def test_openai_to_anthropic_converts_text_and_tool_calls():
    text_out = ai_proxy._openai_to_anthropic(
        {"choices": [{"message": {"content": "你好"}, "finish_reason": "stop"}]}
    )
    assert text_out["content"] == [{"type": "text", "text": "你好"}]
    assert text_out["stop_reason"] == "end_turn"

    tool_out = ai_proxy._openai_to_anthropic(
        {
            "choices": [
                {
                    "message": {
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "t1",
                                "type": "function",
                                "function": {"name": "run_sheet", "arguments": '{"a":1}'},
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ]
        }
    )
    assert tool_out["stop_reason"] == "tool_use"
    assert tool_out["content"][0]["type"] == "tool_use"
    assert tool_out["content"][0]["input"] == {"a": 1}


class _FakeResponse:
    status_code = 200
    text = '{"choices":[{"message":{"content":"hi"},"finish_reason":"stop"}]}'

    def json(self):
        return json.loads(self.text)


class _FakeClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def post(self, url, headers=None, json=None):
        return _FakeResponse()


def test_chat_complete_openai_branch_allows_empty_key(monkeypatch):
    monkeypatch.setattr(ai_proxy, "get_base_url", lambda: "http://localhost:11434")
    monkeypatch.setattr(ai_proxy, "get_api_key", lambda: "")
    monkeypatch.setattr(ai_proxy, "get_model", lambda: "qwen2.5:7b")
    monkeypatch.setattr(ai_proxy.httpx, "AsyncClient", _FakeClient)

    result = asyncio.run(ai_proxy.chat_complete([{"role": "user", "content": "hi"}]))
    assert result["content"] == [{"type": "text", "text": "hi"}]
