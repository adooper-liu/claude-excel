"""ai_proxy.py — Proxy AI API calls to DeepSeek/Qwen/GLM/etc (Anthropic-compatible endpoints)."""

import json
import httpx
from typing import AsyncGenerator, Optional
from config_store import get_api_key, get_base_url, get_model

API_VERSION = "2023-06-01"


async def validate_key(api_key: str, base_url: Optional[str] = None) -> bool:
    """Validate an API key against the provider's models endpoint."""
    url = base_url or get_base_url()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{url}/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": API_VERSION},
            )
            return resp.status_code == 200
    except Exception:
        return False


async def chat_stream(
    messages: list[dict],
    system_prompt: Optional[str] = None,
    model: Optional[str] = None,
    max_tokens: int = 4096,
    tools: Optional[list] = None,
) -> AsyncGenerator[str, None]:
    """Stream a chat completion, yielding text deltas."""
    api_key = get_api_key()
    if not api_key:
        yield "Error: No API key configured. Please set your key in Settings."
        return

    base_url = get_base_url()
    use_model = model or get_model()

    # Separate system messages
    system_parts = []
    if system_prompt:
        system_parts.append(system_prompt)

    api_messages = []
    for m in messages:
        if m.get("role") == "system":
            system_parts.append(m.get("content", ""))
        elif m.get("role") in ("user", "assistant"):
            api_messages.append({"role": m["role"], "content": m.get("content", "")})

    body = {
        "model": use_model,
        "max_tokens": max_tokens,
        "messages": api_messages,
        "stream": True,
    }
    if system_parts:
        body["system"] = [{"type": "text", "text": s} for s in system_parts]
    if tools:
        body["tools"] = tools

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream(
                "POST",
                f"{base_url}/v1/messages",
                headers={
                    "content-type": "application/json",
                    "x-api-key": api_key,
                    "anthropic-version": API_VERSION,
                },
                json=body,
            ) as resp:
                if resp.status_code != 200:
                    text = await resp.aread()
                    yield f"Error: API returned {resp.status_code}: {text.decode()[:300]}"
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
