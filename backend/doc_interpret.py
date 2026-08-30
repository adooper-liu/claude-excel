"""doc_interpret.py — AI-powered semantic interpretation of OCR text.

The OCR pipeline reads the literal text; this module asks the configured
model to interpret meaning and return a document-agnostic, normalized JSON
(kvs / items / totals / notes). Generic prompt only: field names come from
the document itself, never hardcoded business names.
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

import ai_proxy

SYSTEM_PROMPT = """你是文档解读助手。你会收到一段 OCR 识别出的文档文本（可能含错字、噪声、乱码）。
请按文档自己的术语把它整理成结构化 JSON，规则：
1. 只整理 OCR 里明确出现的字段，禁止臆造或补全业务字段名。
2. 抬头键值放进 kvs（数组，每项 {"label": "字段名", "value": "值"}，label 用原文）。
3. 明细表格放进 items（数组，每项 {"columns": ["表头1", ...], "rows": [["单元格", ...], ...]}，值保持原样或归一为数字）。
4. 合计/总计类放进 totals（数组，每项 {"label": ..., "value": ...}）。
5. OCR 疑似错字、乱码或不确定的内容在 notes（字符串数组）里说明，不要静默改值去"猜对"。
只输出一个 JSON 对象，不要 Markdown 代码块，不要任何额外解释。"""


def build_interpret_messages(
    ocr_text: str, rows: list[list[Any]] | None = None
) -> list[dict[str, str]]:
    """Compose the model messages: generic system prompt + OCR text (and rows)."""
    user = "OCR 文本：\n" + str(ocr_text or "")
    if rows:
        user += "\n\n识别出的表格行（可能含噪声）：\n" + json.dumps(rows, ensure_ascii=False)
    return [{"role": "user", "content": user}]


def _extract_text(payload: dict[str, Any]) -> str:
    """Pull assistant text from Anthropic- or OpenAI-style response dicts."""
    content = payload.get("content")
    if isinstance(content, list):
        parts = [
            str(part.get("text") or "")
            for part in content
            if isinstance(part, dict) and part.get("type") == "text"
        ]
        if parts:
            return "\n".join(parts)
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = (choices[0] or {}).get("message") or {}
        text = message.get("content")
        if isinstance(text, str):
            return text
    if isinstance(content, str):
        return content
    return ""


def _strip_code_fence(text: str) -> str:
    cleaned = (text or "").strip()
    if cleaned.startswith("```"):
        lines = cleaned.splitlines()
        if lines and lines[0].strip().startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        cleaned = "\n".join(lines).strip()
    return cleaned


def _scalar(value: Any) -> Any:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    if value is None:
        return ""
    return str(value).strip()


def _normalize_label_value(items: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict) or item.get("label") is None:
            continue
        label = str(item["label"]).strip()
        if label:
            out.append({"label": label, "value": _scalar(item.get("value"))})
    return out


def _normalize_items(items: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if not isinstance(items, list):
        return out
    for item in items:
        if not isinstance(item, dict):
            continue
        columns = [str(c) for c in (item.get("columns") or []) if str(c).strip()]
        rows = []
        for row in item.get("rows") or []:
            if isinstance(row, list):
                rows.append([_scalar(cell) for cell in row])
        if columns or rows:
            out.append({"columns": columns, "rows": rows})
    return out


def parse_interpret_json(raw: str) -> dict[str, Any]:
    """Parse and normalize the model's JSON interpretation (raises ValueError)."""
    text = _strip_code_fence(raw or "")
    try:
        data = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ValueError("模型输出不是有效 JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("解读结果须为 JSON 对象")
    notes = data.get("notes")
    return {
        "kvs": _normalize_label_value(data.get("kvs")),
        "items": _normalize_items(data.get("items")),
        "totals": _normalize_label_value(data.get("totals")),
        "notes": (
            [str(n).strip() for n in notes if str(n).strip()]
            if isinstance(notes, list)
            else []
        ),
    }


async def interpret_document(
    ocr_text: str,
    *,
    rows: list[list[Any]] | None = None,
    model: str | None = None,
    model_call: Callable[..., Awaitable[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Ask the configured model to interpret OCR text into normalized JSON."""
    call = model_call or ai_proxy.chat_complete
    messages = build_interpret_messages(ocr_text, rows)
    payload = await call(messages, system_prompt=SYSTEM_PROMPT, model=model)
    text = _extract_text(payload)
    if not text:
        raise ValueError("模型未返回可读内容")
    if text.startswith("Error:"):
        raise ValueError(text)
    return parse_interpret_json(text)