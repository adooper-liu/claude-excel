"""recipe_propose.py — Infer field types and propose a template from a layout.

Generic operators only: inference is driven by the document's own headers and
key names, never by hardcoded business fields.  The user confirms/edits the
proposal before it is saved as a doc-recipe.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from format_clean import clean_number, is_null
from layout_doc import LayoutDocument, normalize_key

#: Date formats tried (left to right) when inferring the date type.
DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%Y.%m.%d")
#: Sample cap used for type inference (>=3 samples, fewer -> all).
MAX_SAMPLES = 3
#: Currency symbols that mark a column as ``amount``.
CURRENCY_SYMBOLS = ("$", "€", "£", "¥", "￥")
#: At least one letter or CJK char makes a token a plausible field name.
_WORD_RE = re.compile(r"[A-Za-z\u4e00-\u9fff]")


def _is_usable_field_name(name: Any) -> bool:
    """Drop OCR noise as a proposed field name (generic, no business names).

    - ``label: value`` merged by OCR is not a clean field name.
    - A run of digits/symbols with no letter/CJK (phone/invoice numbers OCR'd
      as one token) is noise, not a column header.
    """
    text = str(name or "").strip()
    if not text:
        return False
    if ":" in text or "：" in text:
        return False
    return bool(_WORD_RE.search(text))


def _samples(values: list[Any]) -> list[str]:
    samples = [str(value).strip() for value in values or [] if not is_null(value)]
    return samples[:MAX_SAMPLES] if len(samples) >= MAX_SAMPLES else samples


def _parseable_as_float(text: str) -> bool:
    try:
        float(text)
        return True
    except (TypeError, ValueError):
        return False


def _is_date(text: str) -> bool:
    return any(
        _parse_date(text, fmt) is not None for fmt in DATE_FORMATS
    )


def _parse_date(text: str, fmt: str) -> str | None:
    try:
        return datetime.strptime(text, fmt).date().isoformat()
    except ValueError:
        return None


def infer_type(values: list[Any]) -> str:
    """Infer a field type from content features (generic, no business names).

    Rule order: percent -> amount -> number -> date -> text.
    """
    samples = _samples(values)
    if not samples:
        return "text"

    if all("%" in sample and _parseable_as_float(sample.replace("%", "").strip()) for sample in samples):
        return "percent"
    def _amount_parseable(sample: str) -> bool:
        stripped = "".join(ch for ch in sample if ch not in CURRENCY_SYMBOLS).strip()
        return (
            clean_number(stripped, "us") is not None
            or clean_number(stripped, "eu") is not None
        )

    if all(
        any(symbol in sample for symbol in CURRENCY_SYMBOLS)
        and _amount_parseable(sample)
        for sample in samples
    ):
        return "amount"
    if all(
        clean_number(sample, "us") is not None or clean_number(sample, "eu") is not None
        for sample in samples
    ):
        return "number"
    if all(_is_date(sample) for sample in samples):
        return "date"
    return "text"


def _detail_fields(layout: LayoutDocument) -> list[dict[str, Any]]:
    table = layout.first_table()
    if table is None:
        return []
    headers = [str(h).strip() for h in table.headers if str(h).strip()]
    fields: list[dict[str, Any]] = []
    if headers:
        for index, header in enumerate(headers):
            if not _is_usable_field_name(header):
                continue
            values = [row[index] for row in table.rows if index < len(row)]
            fields.append(
                {
                    "name": header,
                    "type": infer_type(values),
                    "source": header,
                    "group": "detail",
                }
            )
        return fields
    width = max((len(row) for row in table.rows), default=0)
    for index in range(width):
        values = [row[index] for row in table.rows if index < len(row)]
        fields.append(
            {
                "name": "col" + str(index + 1),
                "type": infer_type(values),
                "source": "",
                "group": "detail",
            }
        )
    return fields


def propose_recipe(layout: LayoutDocument, *, base_name: str = "") -> dict[str, Any]:
    """Build a template candidate from a layout's headers and key-values."""
    fields: list[dict[str, Any]] = _detail_fields(layout)
    for kv in layout.kvs:
        if not _is_usable_field_name(kv.label):
            continue
        fields.append(
            {
                "name": kv.label,
                "type": infer_type([kv.value]),
                "source": kv.label,
                "group": "header",
            }
        )
    # Deduplicate by normalized name (detail first): the same label often
    # appears both as a table header and as a key-value pair.
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for field in fields:
        key = normalize_key(field.get("name") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(field)
    fields = deduped
    raw_head = (layout.raw_text or "").strip().replace("\n", " ")[:20]
    name = (base_name or "").strip() or raw_head or "新模板"
    return {
        "name": name,
        "description": "自动生成，请确认字段名与类型",
        "fields": fields,
    }

