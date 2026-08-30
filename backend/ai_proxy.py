"""ai_proxy.py — Proxy AI API calls to Anthropic-compatible endpoints."""

import json
from typing import Any, AsyncGenerator, Optional

import httpx
from config_store import get_active_provider, get_api_key, get_base_url, get_model
from web_tools import merge_web_search, should_inject_web_search

API_VERSION = "2023-06-01"


def _is_openai_api(base_url: str) -> bool:
    """True for OpenAI-compatible endpoints (explicit apiStyle or Ollama)."""
    try:
        active = get_active_provider()
        if str(active.get("apiStyle") or "").strip().lower() == "openai":
            return True
    except Exception:
        pass
    url = str(base_url or "").strip().lower()
    return "localhost:11434" in url or "127.0.0.1:11434" in url


def _headers_for(base_url: str, api_key: str) -> dict[str, str]:
    if _is_openai_api(base_url):
        headers = {"content-type": "application/json"}
        if api_key:
            headers["Authorization"] = "Bearer " + api_key
        return headers
    return {
        "content-type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": API_VERSION,
    }


def _headers(api_key: str) -> dict[str, str]:
    return _headers_for(get_base_url(), api_key)


def _collect_system(system_prompt: Any, messages: list[dict]) -> list[str]:
    parts: list[str] = []
    if isinstance(system_prompt, str) and system_prompt:
        parts.append(system_prompt)
    elif isinstance(system_prompt, list):
        for part in system_prompt:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict) and part.get("text"):
                parts.append(part["text"])
    for m in messages:
        if m.get("role") == "system":
            content = m.get("content", "")
            if isinstance(content, str) and content:
                parts.append(content)
    return parts


def _tools_openai(tools: list[dict]) -> list[dict]:
    out: list[dict[str, Any]] = []
    for tool in tools or []:
        out.append(
            {
                "type": "function",
                "function": {
                    "name": str(tool.get("name") or ""),
                    "description": str(tool.get("description") or ""),
                    "parameters": (
                        tool.get("input_schema")
                        or tool.get("parameters")
                        or {"type": "object", "properties": {}}
                    ),
                },
            }
        )
    return out


def _payload_openai(
    messages: list[dict],
    system_prompt: Optional[Any],
    model: Optional[str],
    max_tokens: int,
    tools: Optional[list],
    stream: bool,
) -> dict:
    system_parts = _collect_system(system_prompt, messages)
    api_messages: list[dict[str, Any]] = []
    if system_parts:
        api_messages.append({"role": "system", "content": "\n\n".join(system_parts)})
    for m in messages:
        role = m.get("role")
        if role == "system":
            continue
        if role in ("user", "assistant"):
            api_messages.append({"role": role, "content": m.get("content", "")})

    body: dict[str, Any] = {
        "model": model or get_model(),
        "max_tokens": max_tokens,
        "messages": api_messages,
        "stream": stream,
    }
    merged = list(tools or [])
    if should_inject_web_search(get_base_url()):
        merged = merge_web_search(merged)
    if merged:
        body["tools"] = _tools_openai(merged)
    return body


def _openai_text(value: Any) -> str:
    """OpenAI ``message.content`` may be a string or a list of text parts."""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts: list[str] = []
        for part in value:
            if isinstance(part, dict) and part.get("text"):
                parts.append(str(part.get("text")))
        return "".join(parts)
    return ""


def _openai_to_anthropic(data: dict) -> dict:
    """Convert an OpenAI chat completion into an Anthropic-style response."""
    choice = (data.get("choices") or [{}])[0]
    message = choice.get("message") or {}
    finish = choice.get("finish_reason")
    content: list[dict[str, Any]] = []
    text = _openai_text(message.get("content"))
    if text:
        content.append({"type": "text", "text": text})
    tool_calls = message.get("tool_calls") or []
    for tc in tool_calls:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") or {}
        try:
            arguments = json.loads(fn.get("arguments") or "{}")
        except (TypeError, ValueError):
            arguments = {}
        content.append(
            {
                "type": "tool_use",
                "id": str(tc.get("id") or ""),
                "name": str(fn.get("name") or ""),
                "input": arguments,
            }
        )
    stop_reason = (
        "tool_use"
        if tool_calls
        else ("max_tokens" if finish == "length" else "end_turn")
    )
    return {"content": content, "stop_reason": stop_reason, "model": data.get("model")}


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
    endpoint = f"{url}/v1/chat/completions" if _is_openai_api(url) else f"{url}/v1/messages"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                endpoint,
                headers=_headers_for(url, api_key),
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
            headers=_headers_for(base_url, api_key),
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
    base_url = get_base_url()
    api_key = get_api_key()
    openai = _is_openai_api(base_url)
    if not api_key and not openai:
        return {
            "content": [
                {"type": "text", "text": "Error: No API key configured. Please set your key in Settings."}
            ]
        }

    body = (
        _payload_openai(messages, system_prompt, model, max_tokens, tools, stream=False)
        if openai
        else _payload(messages, system_prompt, model, max_tokens, tools, stream=False)
    )
    endpoint = f"{base_url}/v1/chat/completions" if openai else f"{base_url}/v1/messages"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.post(endpoint, headers=_headers(api_key), json=body)
            if resp.status_code != 200:
                return {
                    "content": [
                        {
                            "type": "text",
                            "text": _api_error_text(resp.status_code, resp.text),
                        }
                    ]
                }
            return _openai_to_anthropic(resp.json()) if openai else resp.json()
    except Exception as e:
        return {"content": [{"type": "text", "text": f"Error: {e}"}]}


async def chat_stream(
    messages: list[dict],
    system_prompt: Optional[Any] = None,
    model: Optional[str] = None,
    max_tokens: int = 4096,
    tools: Optional[list] = None,
) -> AsyncGenerator[str, None]:
    """Stream a chat completion, yielding text deltas (OpenAI- and Anthropic-style)."""
    base_url = get_base_url()
    api_key = get_api_key()
    openai = _is_openai_api(base_url)
    if not api_key and not openai:
        yield "Error: No API key configured. Please set your key in Settings."
        return

    body = (
        _payload_openai(messages, system_prompt, model, max_tokens, tools, stream=True)
        if openai
        else _payload(messages, system_prompt, model, max_tokens, tools, stream=True)
    )
    endpoint = f"{base_url}/v1/chat/completions" if openai else f"{base_url}/v1/messages"
    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                endpoint,
                headers=_headers(api_key),
                json=body,
            ) as resp:
                if resp.status_code != 200:
                    text = await resp.aread()
                    yield _api_error_text(resp.status_code, text.decode(errors="replace"))
                    return

                if openai:
                    async for line in resp.aiter_lines():
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:].strip()
                        if data_str == "[DONE]":
                            continue
                        try:
                            event = json.loads(data_str)
                            choices = event.get("choices") or []
                            if not choices:
                                continue
                            delta = choices[0].get("delta") or {}
                            text = delta.get("content")
                            if isinstance(text, str) and text:
                                yield text
                        except json.JSONDecodeError:
                            pass
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
