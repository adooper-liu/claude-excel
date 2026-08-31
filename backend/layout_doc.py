"""layout_doc.py — Layout document model between extraction and recipes.

Upgrades the flat ``list[list[str]]`` extraction result into a structured
document: key-value pairs (invoice number, dates, totals) plus one or more
tables.  Both the local word-box path and the cloud doc-parse path produce
this same model, so template proposal and application stay backend-agnostic.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


def normalize_key(text: Any) -> str:
    """Normalize a label/header for fuzzy matching.

    Trims whitespace, converts full-width characters (U+FF01..U+FF5E and
    U+3000) to half-width, removes all remaining whitespace, and lowercases
    ASCII letters — so ``"发 票 号　码"`` matches ``"发票号码"`` and
    ``"AMOUNT"`` matches ``"amount"``.
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
    return re.sub(r"\s+", "", "".join(chars)).lower()


@dataclass
class KVItem:
    """A header key-value pair (e.g. 发票号码 -> 12345678).

    ``position`` is the normalized (0..1 relative to the document) bbox of the
    OCR box this key-value was read from, when known.  Used as a spatial
    fallback/disambiguator by templates with position anchors.
    """

    label: str
    value: str
    position: tuple[float, float, float, float] | None = None


@dataclass
class TableBlock:
    """One detected table with a normalized header row and data rows.

    ``column_positions`` holds each column's x-center normalized to the
    table's x-extent (0..1), when the table was reconstructed positionally.
    """

    name: str
    headers: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    column_positions: list[float] | None = None

    def column(self, name: str) -> int | None:
        """Index of the header matching ``name`` (normalized), else None."""
        target = normalize_key(name)
        for index, header in enumerate(self.headers):
            if normalize_key(header) == target:
                return index
        return None


@dataclass
class LayoutDocument:
    """Structured extraction result: key-values + tables + raw text."""

    kvs: list[KVItem] = field(default_factory=list)
    tables: list[TableBlock] = field(default_factory=list)
    raw_text: str = ""
    #: Which extraction engine produced this layout: rapid / tesseract /
    #: doc-parse / pdf-text / rows ("" = unknown).
    engine: str = ""

    def first_table(self) -> TableBlock | None:
        """The most relevant table: prefers a header row (detail table), then
        size (rows x columns).  None when no table was found."""
        if not self.tables:
            return None
        return max(
            self.tables,
            key=lambda t: (
                len(t.headers),
                len(t.rows) * max((len(r) for r in t.rows), default=0),
            ),
        )

    def kv(self, label: str) -> str | None:
        """Value for the N-th KV item whose label matches (normalized).

        ``label`` may carry an occurrence suffix ``#N`` (e.g. ``名称#2``) to
        pick the N-th match for labels repeated in the document (购买方/销售方
        blocks share the same key names).
        """
        raw = str(label or "").strip()
        target = raw
        occurrence = 1
        if "#" in raw:
            base, _, suffix = raw.rpartition("#")
            if base and suffix.isdigit():
                target = base
                occurrence = int(suffix)
        normalized = normalize_key(target)
        seen = 0
        for item in self.kvs:
            if normalize_key(item.label) == normalized:
                seen += 1
                if seen == occurrence:
                    return item.value
        return None

    def to_dict(self) -> dict[str, Any]:
        """JSON-serializable dict (kvs / tables / raw_text)."""
        return {
            "kvs": [
                {
                    "label": kv.label,
                    "value": kv.value,
                    "position": list(kv.position) if kv.position else None,
                }
                for kv in self.kvs
            ],
            "tables": [
                {
                    "name": table.name,
                    "headers": list(table.headers),
                    "rows": [list(row) for row in table.rows],
                    "column_positions": (
                        list(table.column_positions)
                        if table.column_positions
                        else None
                    ),
                }
                for table in self.tables
            ],
            "raw_text": self.raw_text,
            "engine": self.engine,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "LayoutDocument":
        data = data or {}
        def _position(value: Any) -> tuple[float, float, float, float] | None:
            if not isinstance(value, (list, tuple)) or len(value) != 4:
                return None
            try:
                return tuple(float(v) for v in value)  # type: ignore[return-value]
            except (TypeError, ValueError):
                return None

        kvs = [
            KVItem(
                str(item.get("label", "")),
                str(item.get("value", "")),
                _position(item.get("position")),
            )
            for item in (data.get("kvs") or [])
            if isinstance(item, dict)
        ]
        tables: list[TableBlock] = []
        for item in data.get("tables") or []:
            if not isinstance(item, dict):
                continue
            headers = [str(header) for header in item.get("headers") or []]
            rows = [
                [str(cell) for cell in (row or [])]
                for row in item.get("rows") or []
            ]
            column_positions = item.get("column_positions")
            if isinstance(column_positions, (list, tuple)):
                try:
                    column_positions = [float(v) for v in column_positions]
                except (TypeError, ValueError):
                    column_positions = None
            tables.append(
                TableBlock(
                    str(item.get("name") or ""),
                    headers,
                    rows,
                    column_positions,
                )
            )
        return cls(
            kvs=kvs,
            tables=tables,
            raw_text=str(data.get("raw_text") or ""),
            engine=str(data.get("engine") or ""),
        )
