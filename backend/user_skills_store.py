"""Installed user skills as SKILL.md under ~/.claude-excel-web/skills/."""

from __future__ import annotations

import re
import shutil
from pathlib import Path

from config_store import CONFIG_DIR

SKILLS_DIR = CONFIG_DIR / "skills"
MAX_SKILLS = 40
MAX_BYTES = 64 * 1024

RESERVED = {
    "reconcile",
    "reshape",
    "calculate",
    "对账",
    "整形",
    "计算",
    "去重",
    "反透视",
    "求和",
    "匹配",
    "修公式",
    "skill",
    "skills",
    "安装",
    "install",
}


def reserved_skill_id(value: str) -> bool:
    return str(value or "").strip() in RESERVED


def _unquote(v: str) -> str:
    s = v.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        return s[1:-1].strip()
    return s


def _safe_id(name: str) -> str:
    s = str(name or "").strip()
    if not s or s in (".", "..") or re.search(r"[\\/:]", s) or len(s) > 64:
        raise ValueError("SKILL.md 的 name 无效")
    return s


def parse_skill_md(raw: str) -> dict:
    text = str(raw or "").lstrip("\ufeff")
    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$", text)
    if not m:
        raise ValueError("SKILL.md 需要 YAML frontmatter（name、description）")
    meta: dict[str, str] = {}
    for line in m.group(1).splitlines():
        kv = re.match(r"^([A-Za-z][\w-]*)\s*:\s*(.*)$", line)
        if not kv:
            continue
        val = _unquote(kv.group(2) or "")
        if val:
            meta[kv.group(1)] = val
    name = meta.get("name") or ""
    description = meta.get("description") or ""
    if not name or not description:
        raise ValueError("SKILL.md 需要 name 和 description")
    skill_id = _safe_id(name)
    slash = _unquote(meta.get("slash") or skill_id).lstrip("/").strip()
    if not slash or re.search(r"\s", slash) or len(slash) > 20:
        raise ValueError("slash 无效")
    if reserved_skill_id(skill_id) or reserved_skill_id(slash):
        raise ValueError("不能覆盖内置技能")
    body = (m.group(2) or "").strip()
    if not body:
        raise ValueError("SKILL.md 正文不能为空")
    return {"id": skill_id, "slash": slash, "title": description, "body": body}


def list_skills(root: Path | None = None) -> list[dict]:
    base = root or SKILLS_DIR
    if not base.exists():
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for md in sorted(base.glob("*/SKILL.md")):
        try:
            parsed = parse_skill_md(md.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            continue
        if parsed["slash"] in seen:
            continue
        seen.add(parsed["slash"])
        out.append(parsed)
        if len(out) >= MAX_SKILLS:
            break
    return out


def install_skill(root: Path | None, markdown: str) -> dict:
    raw = str(markdown or "")
    if len(raw.encode("utf-8")) > MAX_BYTES:
        raise ValueError("SKILL.md 太大")
    parsed = parse_skill_md(raw)
    base = root or SKILLS_DIR
    existing = list_skills(base)
    if (
        len(existing) >= MAX_SKILLS
        and parsed["id"] not in {s["id"] for s in existing}
    ):
        raise ValueError("最多安装 40 个外部技能")
    dest = base / parsed["id"]
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "SKILL.md").write_text(raw.replace("\r\n", "\n"), encoding="utf-8")
    return parsed


def delete_skill(root: Path | None, skill_id: str) -> None:
    sid = _safe_id(skill_id)
    if reserved_skill_id(sid):
        raise ValueError("不能删除内置技能")
    dest = (root or SKILLS_DIR) / sid
    if not dest.exists():
        raise FileNotFoundError(sid)
    shutil.rmtree(dest)
