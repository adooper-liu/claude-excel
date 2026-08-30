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
    """A header key-value pair (e.g. 发票号码 -> 12345678)."""

    label: str
    value: str


@dataclass
class TableBlock:
    """One detected table with a normalized header row and data rows."""

    name: str
    headers: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)

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

    def first_table(self) -> TableBlock | None:
        """The largest/most relevant table, or None when no table was found."""
        if not self.tables:
            return None
        return max(self.tables, key=lambda t: len(t.rows) * max((len(r) for r in t.rows), default=0))

    def kv(self, label: str) -> str | None:
        """Value for the first KV item whose label matches (normalized)."""
        target = normalize_key(label)
        for item in self.kvs:
            if normalize_key(item.label) == target:
                return item.value
        return None

    def to_dict(self) -> dict[str, Any]:
        """JSON-serializable dict (kvs / tables / raw_text)."""
        return {
            "kvs": [{"label": kv.label, "value": kv.value} for kv in self.kvs],
            "tables": [
                {
                    "name": table.name,
                    "headers": list(table.headers),
                    "rows": [list(row) for row in table.rows],
                }
                for table in self.tables
            ],
            "raw_text": self.raw_text,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any] | None) -> "LayoutDocument":
        data = data or {}
        kvs = [
            KVItem(str(item.get("label", "")), str(item.get("value", "")))
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
            tables.append(TableBlock(str(item.get("name") or ""), headers, rows))
        return cls(
            kvs=kvs,
            tables=tables,
            raw_text=str(data.get("raw_text") or ""),
        )
