"""ai_proxy.py — Proxy AI API calls to Anthropic-compatible endpoints."""

import json
from typing import Any, AsyncGenerator, Optional

import httpx
from config_store import get_api_key, get_base_url, get_model
from web_tools import merge_web_search, should_inject_web_search

API_VERSION = "2023-06-01"


def _headers(api_key: str) -> dict[str, str]:
    return {
        "content-type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": API_VERSION,
    }


def _api_error_text(status_code: int, body_text: str) -> str:
    """Turn an upstream error body into a friendly one-line error.

    Prefers the provider's ``error.message`` (e.g. the rate-limit reset hint)
    over dumping raw JSON, and special-cases 429 so the user knows it is a
    quota issue rather than a bug.
    """
    message = ""
    try:
        payload = json.loads(body_text or "{}")
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                message = str(error.get("message") or "").strip()
            if not message:
                message = str(payload.get("message") or "").strip()
    except (TypeError, ValueError):
        message = ""
    detail = (message or (body_text or "").strip())[:300]
    if status_code == 429:
        return "Error: 模型限流（429），已达使用上限：%s" % detail
    return "Error: API 返回 %s：%s" % (status_code, detail)


def _payload(
    messages: list[dict],
    system_prompt: Optional[Any],
    model: Optional[str],
    max_tokens: int,
    tools: Optional[list],
    stream: bool,
) -> dict:
    system_parts: list[str] = []
    if isinstance(system_prompt, str) and system_prompt:
        system_parts.append(system_prompt)
    elif isinstance(system_prompt, list):
        for part in system_prompt:
            if isinstance(part, str):
                system_parts.append(part)
            elif isinstance(part, dict) and part.get("text"):
                system_parts.append(part["text"])

    api_messages = []
    for m in messages:
        role = m.get("role")
        if role == "system":
            content = m.get("content", "")
            if isinstance(content, str):
                system_parts.append(content)
            continue
        if role in ("user", "assistant"):
            api_messages.append({"role": role, "content": m.get("content", "")})

    body: dict[str, Any] = {
        "model": model or get_model(),
        "max_tokens": max_tokens,
        "messages": api_messages,
        "stream": stream,
    }
    if system_parts:
        body["system"] = [{"type": "text", "text": s} for s in system_parts]
    merged = list(tools or [])
    if should_inject_web_search(get_base_url()):
        merged = merge_web_search(merged)
    if merged:
        body["tools"] = merged
    return body


async def validate_key(
    api_key: str, base_url: Optional[str] = None, model: Optional[str] = None
) -> bool:
    """Validate an API key against the provider's messages endpoint.

    GET /v1/models 对部分供应商（如智谱）不校验 key（假 key 也 200），
    必须用 /v1/messages 才真实校验。
    """
    url = base_url or get_base_url()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                f"{url}/v1/messages",
                headers={
                    "content-type": "application/json",
                    "x-api-key": api_key,
                    "anthropic-version": API_VERSION,
                },
                json={
                    "model": model or get_model(),
                    "max_tokens": 1,
                    "messages": [{"role": "user", "content": "ping"}],
                },
            )
            return resp.status_code == 200
    except Exception:
        return False


async def fetch_models(base_url: str, api_key: str) -> list[dict]:
    """拉取 provider 的模型列表（GET {base_url}/v1/models，需有效 key）。"""
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(
            f"{base_url}/v1/models",
            headers={"x-api-key": api_key, "anthropic-version": API_VERSION},
        )
        resp.raise_for_status()
        data = resp.json()
        return [
            {"id": m.get("id"), "name": m.get("display_name") or m.get("id")}
            for m in data.get("data", [])
            if m.get("id")
        ]


async def chat_complete(
    messages: list[dict],
    system_prompt: Optional[Any] = None,
    model: Optional[str] = None,
    max_tokens: int = 4096,
    tools: Optional[list] = None,
) -> dict:
    """Non-streaming proxy. Returns an Anthropic-style messages response dict."""
    api_key = get_api_key()
    if not api_key:
        return {
            "content": [
                {"type": "text", "text": "Error: No API key configured. Please set your key in Settings."}
            ]
        }

    body = _payload(messages, system_prompt, model, max_tokens, tools, stream=False)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(
                f"{get_base_url()}/v1/messages",
                headers=_headers(api_key),
                json=body,
            )
            if resp.status_code != 200:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": _api_error_text(resp.status_code, resp.text),
                        }
                    ]
                }
            return resp.json()
    except Exception as e:
        return {"content": [{"type": "text", "text": f"Error: {e}"}]}


async def chat_stream(
    messages: list[dict],
    system_prompt: Optional[Any] = None,
    model: Optional[str] = None,
    max_tokens: int = 4096,
    tools: Optional[list] = None,
) -> AsyncGenerator[str, None]:
    """Stream a chat completion, yielding text deltas."""
    api_key = get_api_key()
    if not api_key:
        yield "Error: No API key configured. Please set your key in Settings."
        return

    body = _payload(messages, system_prompt, model, max_tokens, tools, stream=True)
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{get_base_url()}/v1/messages",
                headers=_headers(api_key),
                json=body,
            ) as resp:
                if resp.status_code != 200:
                    text = await resp.aread()
                    yield _api_error_text(resp.status_code, text.decode(errors="replace"))
                    return

                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    data_str = line[6:]
                    if data_str == "[DONE]":
                        continue
                    try:
                        event = json.loads(data_str)
                        if event.get("type") == "content_block_delta":
                            delta = event.get("delta", {})
                            if delta.get("type") == "text_delta":
                                yield delta.get("text", "")
                    except json.JSONDecodeError:
                        pass
    except Exception as e:
        yield f"Error: {e}"
