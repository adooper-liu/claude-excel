"""Generic extraction-time cleaning operators driven by user templates."""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from layout_doc import LayoutDocument, normalize_key


def is_null(value: Any, null_values: list[str] | None = None) -> bool:
    """Treat missing values and user-selected marker strings as null."""
    if value is None:
        return True
    text = str(value).strip()
    return not text or text in (null_values or [])


def normalize_ocr_text(text: Any) -> str:
    """Normalize OCR output before numeric parsing.

    Converts full-width digits/symbols to half-width (U+FF01..U+FF5E and
    U+3000) and removes spaces OCR inserted inside digit strings
    (``"1 234.56"`` -> ``"1234.56"``).  Deliberately does NOT guess 0/O or
    1/l substitutions — that is left to an explicit user template format.
    """
    chars: list[str] = []
    for ch in str(text or ""):
        code = ord(ch)
        if ch == "\u3000":
            chars.append(" ")
        elif 0xFF01 <= code <= 0xFF5E:
            chars.append(chr(code - 0xFEE0))
        else:
            chars.append(ch)
    return re.sub(r"(?<=\d)[ \t]+(?=\d)", "", "".join(chars))


def clean_number(
    value: Any,
    number_style: str = "",
    strip_symbols: list[str] | None = None,
    null_values: list[str] | None = None,
) -> float | None:
    """Normalize common thousands/decimal conventions without business knowledge."""
    if is_null(value, null_values):
        return None
    text = normalize_ocr_text(value)
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
    for candidate in (part.strip() for part in fmt.split(";") if part.strip()):
        try:
            return datetime.strptime(text, candidate).date().isoformat()
        except ValueError:
            continue
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
        cells = [
            _clean_field(field, row[index] if index < len(row) else "")
            for index, field in enumerate(fields)
        ]
        out.append(cells[:width])
    return out


def _clean_field(field: dict[str, Any], value: Any) -> Any:
    """Clean one cell by the field's type + format (shared by both paths)."""
    fmt = field.get("format") if isinstance(field.get("format"), dict) else {}
    field_type = str(field.get("type") or "").strip().lower()
    if field_type in ("number", "amount", "percent"):
        strip = fmt.get("stripSymbols") if isinstance(fmt.get("stripSymbols"), list) else []
        if field_type == "amount":
            strip = ["$", "€", "£", "¥", "￥"] + strip
        elif field_type == "percent":
            strip = ["%"] + strip
        return clean_number(
            value,
            str(fmt.get("numberStyle") or ""),
            strip,
            fmt.get("nullValues") if isinstance(fmt.get("nullValues"), list) else [],
        )
    if field_type == "date":
        return clean_date(value, str(fmt.get("dateFormat") or ""))
    return "" if value is None else str(value)


def _kv_by_position(
    layout: Any, position: list[float], tolerance: float = 0.15
) -> str | None:
    """Value of the KV whose normalized bbox center is nearest ``position``.

    Spatial fallback only — never a hard gate: nothing found within the
    tolerance returns None and the field stays empty (same as today).
    """
    px = (float(position[0]) + float(position[2])) / 2.0
    py = (float(position[1]) + float(position[3])) / 2.0
    best_value: str | None = None
    best_dist = tolerance
    for kv in getattr(layout, "kvs", []) or []:
        if not kv.position:
            continue
        cx = (kv.position[0] + kv.position[2]) / 2.0
        cy = (kv.position[1] + kv.position[3]) / 2.0
        dist = max(abs(cx - px), abs(cy - py))
        if dist < best_dist:
            best_dist = dist
            best_value = kv.value
    return best_value


def _column_by_position(
    table: Any, position: list[float], tolerance: float = 0.2
) -> int | None:
    """Index of the column whose normalized x-center is nearest ``position[0]``."""
    column_positions = getattr(table, "column_positions", None)
    if not column_positions or not position:
        return None
    target = float(position[0])
    best: int | None = None
    best_dist = tolerance
    for index, xc in enumerate(column_positions):
        dist = abs(float(xc) - target)
        if dist < best_dist:
            best_dist = dist
            best = index
    return best


def _detail_sheet(
    layout: LayoutDocument, template_name: str, fields: list[dict[str, Any]]
) -> dict[str, Any]:
    """Align detail columns by header name (source), position as fallback."""
    header_row = [str(field.get("name") or "") for field in fields]
    rows: list[list[Any]] = [header_row]
    table = layout.first_table()
    if table is None:
        return {"name": template_name + "-明细", "rows": rows}
    indices: list[int] = []
    for index, field in enumerate(fields):
        source = str(field.get("source") or "").strip()
        column = table.column(source) if source else None
        if column is None and field.get("position"):
            column = _column_by_position(table, field["position"])
        indices.append(column if column is not None else index)
    for data_row in table.rows:
        cells = [
            _clean_field(field, data_row[column] if column < len(data_row) else "")
            for field, column in zip(fields, indices)
        ]
        rows.append(cells)
    return {"name": template_name + "-明细", "rows": rows}


def _header_sheet(
    layout: LayoutDocument, template_name: str, fields: list[dict[str, Any]]
) -> dict[str, Any]:
    """Two-column sheet (field name / cleaned value) from header key-values."""
    rows: list[list[Any]] = [["字段", "值"]]
    for field in fields:
        label = str(field.get("name") or "")
        source = str(field.get("source") or "").strip()
        raw = layout.kv(source) if source else layout.kv(label)
        if raw is None and field.get("position"):
            raw = _kv_by_position(layout, field["position"])
        rows.append([label, _clean_field(field, raw if raw is not None else "")])
    return {"name": template_name + "-抬头", "rows": rows}


def _legacy_sheet(
    layout: LayoutDocument, template_name: str, fields: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Old templates (no group): positional alignment, single detail sheet."""
    table = layout.first_table()
    if table is None:
        header_row = [str(field.get("name") or "") for field in fields]
        return [{"name": template_name + "-明细", "rows": [header_row]}]
    if table.headers:
        source_rows: list[list[str]] = [list(table.headers)]
        source_rows += [list(row) for row in table.rows]
        has_header = True
    else:
        source_rows = [list(row) for row in table.rows]
        has_header = False
    rows = apply_template(source_rows, {"fields": fields}, has_header=has_header)
    return [{"name": template_name + "-明细", "rows": rows}]


def apply_recipe(layout: LayoutDocument, template: dict[str, Any]) -> list[dict[str, Any]]:
    """Apply a template to a LayoutDocument, returning sheet payloads.

    New templates (any field with a ``group``) yield two sheets: ``*-抬头``
    (key-values) and ``*-明细`` (aligned by header name).  Old templates
    without ``group`` fall back to positional alignment into one detail sheet.
    """
    fields = template.get("fields") if isinstance(template.get("fields"), list) else []
    fields = [field for field in fields if isinstance(field, dict)]
    template_name = str(template.get("name") or "模板")
    if not any(field.get("group") for field in fields):
        return _legacy_sheet(layout, template_name, fields)
    detail_fields = [field for field in fields if field.get("group") == "detail"]
    header_fields = [field for field in fields if field.get("group") == "header"]
    return [
        _detail_sheet(layout, template_name, detail_fields),
        _header_sheet(layout, template_name, header_fields),
    ]


_CN_DIGITS = {
    "零": 0, "壹": 1, "贰": 2, "叁": 3, "肆": 4,
    "伍": 5, "陆": 6, "柒": 7, "捌": 8, "玖": 9,
}
_CN_UNITS = {"拾": 10, "佰": 100, "仟": 1000}
_CN_BIG = {"万": 10000, "亿": 100000000}


def _cn_digit_value(text: str) -> int | None:
    return _CN_DIGITS.get(str(text or "").strip())


def _cn_integer(text: str) -> int | None:
    """Parse a Chinese-uppercase integer like 壹佰贰拾叁 -> 123 (generic)."""
    total = 0
    section = 0
    current = 0
    for ch in text:
        if ch in _CN_DIGITS:
            current = _CN_DIGITS[ch]
        elif ch in _CN_UNITS:
            unit = _CN_UNITS[ch]
            section += (current or 1) * unit
            current = 0
        elif ch in _CN_BIG:
            unit = _CN_BIG[ch]
            section = (section + current) * unit
            total += section
            section = 0
            current = 0
        else:
            return None
    return total + section + current


def _cn_fraction(text: str) -> float | None:
    """Parse 角/分 decimals (肆角伍分 -> 0.45)."""
    value = 0.0
    if "角" in text:
        digit = _cn_digit_value(text.split("角")[0])
        if digit is None:
            return None
        value += digit / 10
    if "分" in text:
        digit = _cn_digit_value(text.split("角")[-1].split("分")[0])
        if digit is None:
            return None
        value += digit / 100
    return round(value, 2)


def clean_chinese_amount(value: Any) -> float | None:
    """Parse Chinese-uppercase amounts (壹佰贰拾叁元肆角伍分 -> 123.45).

    Also accepts plain digits with 元 (``"123.45元"``) and ￥/人民币 prefixes.
    Generic parser — no business field names.  Returns None when unparseable.
    """
    text = normalize_ocr_text(value).strip()
    if not text:
        return None
    for prefix in ("人民币", "￥", "¥"):
        if text.startswith(prefix):
            text = text[len(prefix):].strip()
            break
    text = text.replace("整", "").strip()
    if not text:
        return None

    plain = re.fullmatch(r"(\d+(?:\.\d+)?)元?", text)
    if plain:
        return float(plain.group(1))

    if "元" in text:
        integer_text, _, fraction_text = text.partition("元")
        integer = _cn_integer(integer_text)
        if integer is None:
            return None
        fraction = _cn_fraction(fraction_text) if fraction_text else 0.0
        if fraction is None:
            return None
        return integer + fraction

    if "角" in text or "分" in text:
        return _cn_fraction(text)

    integer = _cn_integer(text)
    return float(integer) if integer is not None else None
