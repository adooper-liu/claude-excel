"""Table structure notes — persist semantic understanding of workbook tables across sessions.

Trust tiers（必须分层存，禁止混在一起）：
- schema: 确定性（来自 inspect 的 cols/rows/headers）——高信任
- inferences: LLM 推断，必须带 confidence(low|medium|high) + evidence（样本值/计数），无证据不存——中信任
- advisories: 用户修正 / 读法要点，带 source——中高信任

load 是「假设」不是真相：调用方必须 inspect 实际表对比 schema 后再决定信不信。
旧值存进 previous 供 diff（能查"模型为什么改了主意"）。
写入走 temp 文件 + os.replace 原子替换。
"""

from __future__ import annotations

import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config_store import CONFIG_DIR

NOTES_FILE = CONFIG_DIR / "table-structures.json"
MAX_ENTRIES = 200
CONFIDENCE = {"low", "medium", "high"}
# 合法列字母：A..XFD（1-3 位大写字母）。headers 键必须是它，拒绝列索引等脏键。
COL_LETTER_RE = re.compile(r"^[A-Z]{1,3}$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _atomic_write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _read() -> dict:
    if not NOTES_FILE.exists():
        return {"version": 1, "tables": {}}
    try:
        data = json.loads(NOTES_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {"version": 1, "tables": {}}
    if not isinstance(data, dict) or not isinstance(data.get("tables"), dict):
        return {"version": 1, "tables": {}}
    return data


def get_notes(file_key: str, sheet: str) -> dict | None:
    entry = _read()["tables"].get(str(file_key or ""))
    if not entry:
        return None
    return entry.get(str(sheet or ""))


def _valid_schema(schema: Any) -> bool:
    if not isinstance(schema, dict):
        return False
    if not isinstance(schema.get("cols"), int) or schema["cols"] <= 0:
        return False
    headers = schema.get("headers")
    if not isinstance(headers, dict):
        return False
    # 至少有一个合法列字母键
    return any(COL_LETTER_RE.match(str(k)) for k in headers)


def _valid_inference(i: Any) -> bool:
    if not isinstance(i, dict):
        return False
    claim = str(i.get("claim") or "").strip()
    evidence = str(i.get("evidence") or "").strip()
    confidence = str(i.get("confidence") or "").strip()
    # 无证据的推断不许存——存了就是"把上一次会话的猜测固化"
    return bool(claim) and bool(evidence) and confidence in CONFIDENCE


def _valid_advisory(a: Any) -> bool:
    if not isinstance(a, dict):
        return False
    return bool(str(a.get("note") or "").strip())


def save_notes(file_key: str, sheet: str, payload: dict) -> dict:
    file_key = str(file_key or "").strip()
    sheet = str(sheet or "").strip()
    if not file_key or not sheet:
        raise ValueError("save_structure_note 需要 fileKey + sheet")
    schema = payload.get("schema")
    if not _valid_schema(schema):
        raise ValueError("save_structure_note 需要 schema（cols/headers，来自 inspect，不要凭记忆写）")

    data = _read()
    tables = data["tables"]
    entry = tables.setdefault(file_key, {})
    old = entry.get(sheet)

    new_entry: dict[str, Any] = {
        "file_key": file_key,
        "sheet_name": sheet,
        "last_updated_at": _now_iso(),
        "schema": {
            "cols": int(schema["cols"]),
            "rows": int(schema.get("rows") or 0),
            # 丢弃非法列字母键（如把列索引 184 当字母），防脏键进真相源
            "headers": {
                str(k): str(v)
                for k, v in schema.get("headers", {}).items()
                if COL_LETTER_RE.match(str(k))
            },
        },
        "inferences": [i for i in payload.get("inferences") or [] if _valid_inference(i)],
        "advisories": [a for a in payload.get("advisories") or [] if _valid_advisory(a)],
        "previous": old if isinstance(old, dict) else None,
    }
    entry[sheet] = new_entry
    if len(tables) > MAX_ENTRIES:
        # 简单淘汰：删到上限（本机单用户，够用）
        for k in list(tables.keys())[: len(tables) - MAX_ENTRIES]:
            del tables[k]
    _atomic_write(NOTES_FILE, data)
    return new_entry
