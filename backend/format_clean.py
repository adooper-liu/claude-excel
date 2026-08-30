"""Generic extraction-time cleaning operators driven by user templates."""

from __future__ import annotations

from datetime import datetime
from typing import Any


def is_null(value: Any, null_values: list[str] | None = None) -> bool:
    """Treat missing values and user-selected marker strings as null."""
    if value is None:
        return True
    text = str(value).strip()
    return not text or text in (null_values or [])


def clean_number(
    value: Any,
    number_style: str = "",
    strip_symbols: list[str] | None = None,
    null_values: list[str] | None = None,
) -> float | None:
    """Normalize common thousands/decimal conventions without business knowledge."""
    if is_null(value, null_values):
        return None
    text = str(value).strip()
    for symbol in strip_symbols or []:
        text = text.replace(symbol, "")
    text = "".join(text.split())

    style = (number_style or "").strip().lower()
    if style == "eu":
        text = text.replace(".", "").replace(",", ".")
    elif style == "us":
        text = text.replace(",", "")

    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def clean_date(value: Any, date_format: str) -> str | None:
    """Parse user-selected date formats; without a format, preserve source text.

    Returns an ISO date string (no time component), so JSON serialization stays
    a clean date rather than a timestamp.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    fmt = (date_format or "").strip()
    if not fmt:
        return text
    try:
        return datetime.strptime(text, fmt).date().isoformat()
    except ValueError:
        return None


def apply_template(
    rows: list[list[str]], template: dict[str, Any], *, has_header: bool = True
) -> list[list[Any]]:
    """Align source columns to template fields and clean each typed column.

    ``has_header`` says whether ``rows[0]`` is a source header to skip; callers
    with headerless rows (OCR text) pass ``has_header=False`` so no data row is
    dropped.
    """
    fields = template.get("fields") if isinstance(template.get("fields"), list) else []
    width = len(fields)
    out: list[list[Any]] = [[field.get("name") or "" for field in fields]]

    data_rows = rows[1:] if (has_header and rows) else rows
    for row in data_rows:
        cells: list[Any] = []
        for index, field in enumerate(fields):
            value = row[index] if index < len(row) else ""
            fmt = field.get("format") if isinstance(field.get("format"), dict) else {}
            field_type = str(field.get("type") or "").strip().lower()
            if field_type in ("number", "amount", "percent"):
                strip = fmt.get("stripSymbols") if isinstance(fmt.get("stripSymbols"), list) else []
                if field_type == "amount":
                    strip = ["$", "€", "£", "¥", "￥"] + strip
                elif field_type == "percent":
                    strip = ["%"] + strip
                cells.append(
                    clean_number(
                        value,
                        str(fmt.get("numberStyle") or ""),
                        strip,
                        fmt.get("nullValues") if isinstance(fmt.get("nullValues"), list) else [],
                    )
                )
            elif field_type == "date":
                cells.append(clean_date(value, str(fmt.get("dateFormat") or "")))
            else:
                cells.append("" if value is None else str(value))
        out.append(cells[:width])
    return out
