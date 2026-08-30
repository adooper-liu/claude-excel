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
from layout_doc import normalize_key

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


RECIPE_SYSTEM_PROMPT = """你是文档模板设计助手。你会收到一段 OCR 识别出的文档文本（可能含错字、噪声、碎片）。
请推断一份「识别模板」的字段字典，规则：
1. 字段名用文档自己的术语，把 OCR 碎片整理成干净字段名（例如 "购"/"名" 合并为 "购买方名称"），纯噪声（无字母无中文的符号串）直接丢弃。
2. 每项字段是 {"name": 字段名, "type": "text|number|date|amount|percent", "source": 原文中的键名或表头, "group": "header" 或 "detail"}。
   - group=header：抬头键值字段（如发票号码、开票日期）；
   - group=detail：明细表格列（如品名、金额、税率）。
3. type 按内容推断，且遵守：编号类纯数字长串（发票号码、机器编号、订单号、校验码、纳税人识别号等）用 "text"，不要用 "number"；只有可计算/可比较的量才用 number/amount；含 % 用 percent；日期用 date。
4. source 必须唯一：文档里同一键名出现多次（如购买方与销售方都有「名称/纳税人识别号/地址、电话/开户行及账号」）时，用 "键名#1"、"键名#2" 区分（#N 表示该键第 N 次出现）；对不上原文就用字段名。不要给两个字段填相同 source。
5. 明细只放真正的数据列；「合计/总计」行不当作列字段；价税合计只保留一条（优先保留小写）。
6. 字段总数控制在 20 以内；重复、噪声、无意义字段丢弃。
7. 只输出一个 JSON 对象 {"fields": [...], "notes": [...]}，不要 Markdown 代码块，不要额外解释。
"""

RECIPE_TYPES = ("text", "number", "date", "amount", "percent")
RECIPE_GROUPS = ("header", "detail")
_RECIPE_WORD_RE = __import__("re").compile(r"[A-Za-z\u4e00-\u9fff]")


def _usable_field_name(name: Any) -> bool:
    """Keep names that look like real fields (no colon merge, has letter/CJK)."""
    text = str(name or "").strip()
    if not text:
        return False
    if ":" in text or "：" in text:
        return False
    return bool(_RECIPE_WORD_RE.search(text))


def build_recipe_messages(
    ocr_text: str, rows: list[list[Any]] | None = None
) -> list[dict[str, str]]:
    user = "OCR 文本：\n" + str(ocr_text or "")
    if rows:
        user += "\n\n识别出的表格行（可能含噪声）：\n" + json.dumps(rows, ensure_ascii=False)
    return [{"role": "user", "content": user}]


def _normalize_recipe_field(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict) or item.get("name") is None:
        return None
    name = str(item["name"]).strip()
    if not _usable_field_name(name):
        return None
    field_type = str(item.get("type") or "text").strip().lower()
    if field_type not in RECIPE_TYPES:
        field_type = "text"
    group = str(item.get("group") or "detail").strip().lower()
    if group not in RECIPE_GROUPS:
        group = "detail"
    source = str(item.get("source") or "").strip() or name
    return {
        "name": name[:80],
        "type": field_type,
        "source": source[:100],
        "group": group,
    }


def parse_recipe_json(raw: str) -> dict[str, Any]:
    """Parse + normalize the model's template-candidate JSON (raises ValueError)."""
    text = _strip_code_fence(raw or "")
    try:
        data = json.loads(text)
    except (TypeError, ValueError) as exc:
        raise ValueError("模型输出不是有效 JSON") from exc
    if not isinstance(data, dict):
        raise ValueError("模板候选须为 JSON 对象")
    fields: list[dict[str, Any]] = []
    seen_names: set[str] = set()
    seen_sources: set[str] = set()
    for item in data.get("fields") or []:
        field = _normalize_recipe_field(item)
        if field is None:
            continue
        name_key = normalize_key(field["name"])
        if not name_key or name_key in seen_names:
            continue
        source_key = normalize_key(field["source"])
        if source_key in seen_sources:
            continue
        seen_names.add(name_key)
        seen_sources.add(source_key)
        fields.append(field)
    notes = data.get("notes")
    return {
        "fields": fields,
        "notes": (
            [str(n).strip() for n in notes if str(n).strip()]
            if isinstance(notes, list)
            else []
        ),
    }


async def propose_recipe_ai(
    ocr_text: str,
    *,
    rows: list[list[Any]] | None = None,
    base_name: str = "",
    model: str | None = None,
    model_call: Callable[..., Awaitable[dict[str, Any]]] | None = None,
) -> dict[str, Any]:
    """Ask the model to clean up OCR noise into a doc-recipe template candidate."""
    call = model_call or ai_proxy.chat_complete
    messages = build_recipe_messages(ocr_text, rows)
    payload = await call(messages, system_prompt=RECIPE_SYSTEM_PROMPT, model=model)
    text = _extract_text(payload)
    if not text:
        raise ValueError("模型未返回可读内容")
    if text.startswith("Error:"):
        raise ValueError(text)
    parsed = parse_recipe_json(text)
    name = (base_name or "").strip() or "新模板"
    return {
        "name": name,
        "description": "AI 生成，请确认字段名与类型",
        "fields": parsed["fields"],
        "notes": parsed["notes"],
    }
