"""Packs: bundle sample skills + knowledge + recipe deps under samples/packs/.

Pack is an organization layer, not a new mechanism. install_pack() reuses
install_skill() for each SKILL.md; knowledge files are listed but indexed
via the knowledge bar (not auto-ingested in P0).
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from config_store import CONFIG_DIR
from user_extension_registry import (
    INSTALLED_PACKS_FILE,
    RUNTIME_PACKS_DIR,
    list_catalog_extensions,
    pack_capability_hash,
)

SAMPLES_DIR = Path(__file__).resolve().parents[1] / "samples"
PACKS_DIR = SAMPLES_DIR / "packs"
TAXONOMY_FILE = SAMPLES_DIR / "taxonomy.json"

# Cap so a malformed pack can't dump a huge number of skills.
MAX_PACK_SKILLS = 20
MAX_PACK_KNOWLEDGE = 20
MAX_PACK_EXTENSIONS = 20


def _read_json(path: Path) -> dict:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"无法读取 {path.name}: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path.name} 需要是 JSON 对象")
    return data


def load_taxonomy() -> list[dict]:
    if not TAXONOMY_FILE.is_file():
        return []
    data = _read_json(TAXONOMY_FILE)
    cats = data.get("categories")
    if not isinstance(cats, list):
        return []
    return [c for c in cats if isinstance(c, dict) and c.get("id")]


def category_label(category_id: str) -> str:
    for c in load_taxonomy():
        if c.get("id") == category_id:
            return str(c.get("label") or category_id)
    return category_id or "未分类"


def list_packs() -> list[dict]:
    """Scan samples/packs/*/pack.json and return catalog entries."""
    if not PACKS_DIR.is_dir():
        return []
    out: list[dict] = []
    for pack_dir in sorted(PACKS_DIR.iterdir()):
        pf = pack_dir / "pack.json"
        if not pf.is_file():
            continue
        try:
            pack = _read_json(pf)
        except ValueError:
            continue
        pid = str(pack.get("id") or "").strip()
        if not pid:
            continue
        skills = _list_skills(pack_dir)
        knowledge = _list_knowledge(pack_dir)
        extensions = list_catalog_extensions(pack_dir)
        out.append(
            {
                "id": pid,
                "category": str(pack.get("category") or ""),
                "categoryLabel": category_label(str(pack.get("category") or "")),
                "title": str(pack.get("title") or pid),
                "description": str(pack.get("description") or ""),
                "version": str(pack.get("version") or ""),
                "skills": skills,
                "knowledge": knowledge,
                "extensions": extensions,
                "deps": pack.get("deps") or {},
                "installed": pid in _installed_ids(),
            }
        )
    return out


def _list_skills(pack_dir: Path) -> list[dict]:
    skills_root = pack_dir / "skills"
    if not skills_root.is_dir():
        return []
    out: list[dict] = []
    for skill_dir in sorted(skills_root.iterdir()):
        md = skill_dir / "SKILL.md"
        if not md.is_file():
            continue
        # Lightweight frontmatter read for catalog; install re-parses via install_skill.
        try:
            text = md.read_text(encoding="utf-8")
        except OSError:
            continue
        name = _frontmatter_field(text, "name") or skill_dir.name
        slash = _frontmatter_field(text, "slash") or name
        title = _frontmatter_field(text, "description") or name
        out.append({"id": name, "slash": slash, "title": title})
    return out


def _frontmatter_field(text: str, key: str) -> str:
    import re

    m = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n", text)
    if not m:
        return ""
    for line in m.group(1).splitlines():
        kv = re.match(rf"^{re.escape(key)}\s*:\s*(.*)$", line)
        if kv:
            val = kv.group(1).strip()
            if (val.startswith('"') and val.endswith('"')) or (
                val.startswith("'") and val.endswith("'")
            ):
                val = val[1:-1].strip()
            return val
    return ""


def _list_knowledge(pack_dir: Path) -> list[str]:
    know_root = pack_dir / "knowledge"
    if not know_root.is_dir():
        return []
    return sorted(p.name for p in know_root.iterdir() if p.is_file())


def _read_installed_records() -> list[dict[str, Any]]:
    try:
        data = json.loads(INSTALLED_PACKS_FILE.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return [r for r in data if isinstance(r, dict)]
    except (OSError, json.JSONDecodeError):
        pass
    return []


def _installed_ids() -> set[str]:
    return {str(r.get("id") or "").strip() for r in _read_installed_records() if r.get("id")}


def _copy_pack_extensions(pack_dir: Path, pack_id: str) -> list[dict[str, Any]]:
    extensions = list_catalog_extensions(pack_dir)
    runtime_pack = RUNTIME_PACKS_DIR / pack_id
    ext_root = runtime_pack / "extensions"
    if ext_root.exists():
        shutil.rmtree(ext_root)
    if not extensions:
        return []
    for ext in extensions:
        src = pack_dir / "extensions" / ext["id"]
        dst = ext_root / ext["id"]
        shutil.copytree(src, dst)
    return extensions


def _load_runtime_manifests(pack_id: str) -> list[dict[str, Any]]:
    ext_root = RUNTIME_PACKS_DIR / pack_id / "extensions"
    if not ext_root.is_dir():
        return []
    manifests: list[dict[str, Any]] = []
    for ext_dir in sorted(ext_root.iterdir()):
        mf = ext_dir / "manifest.json"
        if not mf.is_file():
            continue
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                manifests.append(data)
        except (OSError, json.JSONDecodeError):
            continue
    return manifests


def install_pack(pack_id: str, *, consent_extensions: bool = True) -> dict:
    """Install a sample pack: validate schema, then reuse install_skill() for each SKILL.md."""
    from user_skills_store import delete_skill, install_skill, list_skills

    pid = str(pack_id or "").strip()
    if not pid:
        raise ValueError("packId required")
    pack_dir = PACKS_DIR / pid
    pf = pack_dir / "pack.json"
    if not pf.is_file():
        raise ValueError("示例包不存在: " + pid)

    pack = _read_json(pf)
    if str(pack.get("id") or "").strip() != pid:
        raise ValueError("pack.json 的 id 与目录名不一致")

    category = str(pack.get("category") or "").strip()
    if category and not any(c.get("id") == category for c in load_taxonomy()):
        raise ValueError(f"category 不在 taxonomy 里: {category}")

    skills = _list_skills(pack_dir)
    if len(skills) > MAX_PACK_SKILLS:
        raise ValueError(f"单个 pack 技能数不能超过 {MAX_PACK_SKILLS}")

    declared = pack.get("skills")
    if not isinstance(declared, list) or not declared:
        raise ValueError("pack.json 需要非空 skills 列表")
    declared_ids = {str(x).strip() for x in declared if str(x).strip()}
    disk_ids = {s["id"] for s in skills}
    if declared_ids != disk_ids:
        raise ValueError("pack.json 的 skills 与 skills/ 目录不一致")

    extensions = list_catalog_extensions(pack_dir)
    if len(extensions) > MAX_PACK_EXTENSIONS:
        raise ValueError(f"单个 pack 扩展数不能超过 {MAX_PACK_EXTENSIONS}")

    declared_ext = pack.get("extensions")
    if declared_ext is None:
        declared_ext = []
    if not isinstance(declared_ext, list):
        raise ValueError("pack.json 的 extensions 必须是数组")
    declared_ext_ids = {str(x).strip() for x in declared_ext if str(x).strip()}
    disk_ext_ids = {e["id"] for e in extensions}
    if declared_ext_ids != disk_ext_ids:
        raise ValueError("pack.json 的 extensions 与 extensions/ 目录不一致")

    if extensions and not consent_extensions:
        raise ValueError("此 pack 含本机函数，需要用户同意后才可安装")

    knowledge = _list_knowledge(pack_dir)
    if len(knowledge) > MAX_PACK_KNOWLEDGE:
        raise ValueError(f"单个 pack 知识文件数不能超过 {MAX_PACK_KNOWLEDGE}")

    existing = list_skills()
    if len(existing) + len(skills) > 40:
        # install_skill enforces MAX_SKILLS=40 per call; pre-check gives a clearer error.
        raise ValueError("安装后技能总数超过 40，请先删除部分技能")

    result_skills: list[dict] = []
    for skill in skills:
        skill_dir = pack_dir / "skills" / skill["id"]
        md = skill_dir / "SKILL.md"
        try:
            parsed = install_skill(None, md.read_text(encoding="utf-8"))
        except ValueError as exc:
            # Roll back already-installed skills from this pack so a partial install
            # does not leave the user with half a bundle.
            for done in result_skills:
                try:
                    delete_skill(None, done["id"])
                except Exception:
                    pass
            raise ValueError(f"安装技能 {skill['id']} 失败: {exc}") from exc
        result_skills.append(parsed)

    try:
        _copy_pack_extensions(pack_dir, pid)
    except OSError as exc:
        for done in result_skills:
            try:
                delete_skill(None, done["id"])
            except Exception:
                pass
        raise ValueError(f"复制扩展失败: {exc}") from exc

    manifests = _load_runtime_manifests(pid)
    cap_hash = pack_capability_hash(manifests) if manifests else ""
    now = _now_iso()
    records = [r for r in _read_installed_records() if str(r.get("id") or "").strip() != pid]
    records.append(
        {
            "id": pid,
            "installedAt": now,
            "version": str(pack.get("version") or ""),
            "capabilityHash": cap_hash if extensions else "",
            "consentedAt": now if extensions else "",
        }
    )
    _write_installed(records)

    return {
        "packId": pid,
        "category": category,
        "categoryLabel": category_label(category),
        "title": str(pack.get("title") or pid),
        "skills": result_skills,
        "knowledge": knowledge,
        "extensions": extensions,
    }


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _write_installed(records: list[dict]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    INSTALLED_PACKS_FILE.write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
