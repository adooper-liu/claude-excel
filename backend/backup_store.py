"""backup_store.py — Export / import user data backup.

备份不含 API Key：config 只导出 provider 骨架（Key 置空）。恢复时扩展走信任门
（consent 不随备份生效，恢复后重新同意），防伪造备份跳过同意。
"""

from __future__ import annotations

import io
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config_store import CONFIG_DIR, get_config, save_config
from user_packs_store import _safe_zip_name, install_pack, uninstall_pack
from user_skills_store import delete_skill, install_skill
from knowledge_store import ingest_document



# 动态引用各 store 的路径常量（调用时取值），测试 monkeypatch store 模块即可隔离。
import fetch_recipe
import knowledge_store
import templates_store
import user_extension_registry
import user_packs_store
import user_skills_store

BACKUP_FORMAT = "sheetwise-backup"
BACKUP_VERSION = 1
MAX_BACKUP_BYTES = 50 * 1024 * 1024
MAX_BACKUP_ENTRIES = 2000

ALLOWED_KNOWLEDGE_EXT = {".md", ".markdown", ".txt", ".csv"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _config_skeleton() -> dict:
    cfg = get_config()
    providers = {}
    for pid, p in (cfg.get("providers") or {}).items():
        providers[pid] = {
            "baseUrl": str(p.get("baseUrl") or ""),
            "model": str(p.get("model") or ""),
            "smallFastModel": str(p.get("smallFastModel") or ""),
        }
    return {"activeProvider": str(cfg.get("activeProvider") or "deepseek"), "providers": providers}


def export_backup() -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "format": BACKUP_FORMAT,
            "version": BACKUP_VERSION,
            "createdAt": _now_iso(),
            "appVersion": "3.0.0",
            "contents": ["skills", "knowledge", "packs", "installed-packs", "templates", "fetch-recipes", "config"],
        }
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr("config/provider-skeleton.json", json.dumps(_config_skeleton(), ensure_ascii=False, indent=2))

        skills_dir = user_skills_store.SKILLS_DIR
        if skills_dir.is_dir():
            for md in sorted(skills_dir.glob("*/SKILL.md")):
                zf.write(md, "skills/" + md.parent.name + "/SKILL.md")

        sources = knowledge_store.SOURCES_DIR
        if sources.is_dir():
            for p in sorted(sources.iterdir()):
                if p.is_file() and p.suffix.lower() in ALLOWED_KNOWLEDGE_EXT:
                    zf.write(p, "knowledge/sources/" + p.name)

        imported = user_packs_store.IMPORTED_PACKS_DIR
        if imported.is_dir():
            for pid_dir in sorted(imported.iterdir()):
                if not pid_dir.is_dir() or pid_dir.name.startswith("."):
                    continue
                for p in sorted(pid_dir.rglob("*")):
                    if p.is_file() and "__pycache__" not in p.parts:
                        zf.write(p, "packs/" + pid_dir.name + "/" + p.relative_to(pid_dir).as_posix())

        inst = user_extension_registry.INSTALLED_PACKS_FILE
        if inst.is_file():
            zf.write(inst, "installed-packs.json")

        tpl = templates_store.TEMPLATES_FILE
        if tpl.is_file():
            zf.write(tpl, "templates.json")

        recipes = fetch_recipe.RECIPES_DIR
        if recipes.is_dir():
            for p in sorted(recipes.glob("*.json")):
                zf.write(p, "fetch-recipes/" + p.name)

    data = buf.getvalue()
    if len(data) > MAX_BACKUP_BYTES:
        raise ValueError("备份超过 50MB 上限，请先清理知识库或取数数据")
    return data


def _open_valid_zip(zip_bytes: bytes) -> zipfile.ZipFile:
    if len(zip_bytes) > MAX_BACKUP_BYTES:
        raise ValueError("备份超过 50MB 上限")
    try:
        zf = zipfile.ZipFile(io.BytesIO(zip_bytes))
    except (zipfile.BadZipFile, OSError) as exc:
        raise ValueError("无法解析备份 zip") from exc
    infos = zf.infolist()
    if len(infos) > MAX_BACKUP_ENTRIES:
        raise ValueError(f"备份条目超过 {MAX_BACKUP_ENTRIES} 上限")
    if sum(i.file_size for i in infos) > MAX_BACKUP_BYTES:
        raise ValueError("备份解压超过 50MB 上限")
    for info in infos:
        if not _safe_zip_name(info.filename):
            raise ValueError("备份含非法路径: " + info.filename)
    if not any(info.filename == "manifest.json" and not info.is_dir() for info in infos):
        raise ValueError("备份缺少 manifest.json")
    return zf


def _read_manifest(zf: zipfile.ZipFile) -> dict:
    try:
        data = json.loads(zf.read("manifest.json").decode("utf-8"))
    except (KeyError, json.JSONDecodeError, OSError) as exc:
        raise ValueError("manifest.json 无法解析") from exc
    if not isinstance(data, dict) or data.get("format") != BACKUP_FORMAT:
        raise ValueError("不是 SheetWise 备份文件")
    version = int(data.get("version") or 0)
    if version > BACKUP_VERSION:
        raise ValueError("备份来自更新版本，请先升级应用再导入")
    return data


def _preview_packs(zf: zipfile.ZipFile) -> list[dict]:
    names = zf.namelist()
    out: list[dict] = []
    seen: set[str] = set()
    recs: list[dict] = []
    if "installed-packs.json" in names:
        try:
            data = json.loads(zf.read("installed-packs.json").decode("utf-8"))
            if isinstance(data, list):
                recs = [r for r in data if isinstance(r, dict)]
        except (json.JSONDecodeError, KeyError):
            pass
    for rec in recs:
        pid = str(rec.get("id") or "").strip()
        if not pid or pid in seen:
            continue
        seen.add(pid)
        source = str(rec.get("source") or "")
        # Check if extensions exist in the zip
        prefix = f"packs/{pid}/extensions/"
        has_ext = any(x.startswith(prefix) and not x.endswith("/") for x in names)
        out.append({"id": pid, "source": source, "title": str(rec.get("title") or pid), "hasExtensions": has_ext})
    for n in sorted(names):
        if n.startswith("packs/") and n.endswith("/pack.json"):
            pid = n.split("/")[1]
            if pid in seen:
                continue
            seen.add(pid)
            prefix = f"packs/{pid}/extensions/"
            has_ext = any(x.startswith(prefix) and not x.endswith("/") for x in names)
            out.append({"id": pid, "source": "third-party", "title": pid, "hasExtensions": has_ext})
    return out


def _preview_config(zf: zipfile.ZipFile) -> dict:
    try:
        data = json.loads(zf.read("config/provider-skeleton.json").decode("utf-8"))
    except (KeyError, json.JSONDecodeError, OSError):
        return {"providers": [], "activeProvider": ""}
    providers = data.get("providers") if isinstance(data, dict) else None
    return {
        "providers": list(providers.keys()) if isinstance(providers, dict) else [],
        "activeProvider": str((data or {}).get("activeProvider") or ""),
    }


def _preview_recipes(zf: zipfile.ZipFile) -> list[str]:
    return sorted(
        n[len("fetch-recipes/") :] for n in zf.namelist() if n.startswith("fetch-recipes/") and not n.endswith("/")
    )


def preview_backup(zip_bytes: bytes) -> dict:
    zf = _open_valid_zip(zip_bytes)
    manifest = _read_manifest(zf)
    skills = sorted(
        n.split("/")[1] for n in zf.namelist() if n.startswith("skills/") and n.endswith("/SKILL.md")
    )
    knowledge = sorted(
        Path(n).name for n in zf.namelist() if n.startswith("knowledge/sources/") and not n.endswith("/")
    )
    packs = _preview_packs(zf)
    return {
        "ok": True,
        "manifest": manifest,
        "contents": {
            "skills": skills,
            "knowledge": knowledge,
            "packs": packs,
            "config": _preview_config(zf),
            "templates": "templates.json" in zf.namelist(),
            "recipes": _preview_recipes(zf),
        },
        "needsConsent": any(p.get("hasExtensions") for p in packs),
    }



from knowledge_store import ingest_document


def _staging_dir() -> Path:
    import tempfile
    return Path(tempfile.gettempdir()) / "claude-excel-backup-staging"
async def _restore_skills(staging: Path) -> list[str]:
    skills_root = staging / "skills"
    if not skills_root.is_dir():
        return []
    restored = []
    for md in sorted(skills_root.glob("*/SKILL.md")):
        parsed = install_skill(None, md.read_text(encoding="utf-8"))
        restored.append(parsed["id"])
    return restored


def _restore_packs(staging: Path, *, consent_extensions: bool) -> tuple[list[str], list[str]]:
    recs: list[dict] = []
    rec_file = staging / "installed-packs.json"
    if rec_file.is_file():
        try:
            data = json.loads(rec_file.read_text(encoding="utf-8"))
            if isinstance(data, list):
                recs = [r for r in data if isinstance(r, dict)]
        except (json.JSONDecodeError, OSError):
            pass
    restored: list[str] = []
    extended: list[str] = []
    for rec in recs:
        pid = str(rec.get("id") or "").strip()
        if not pid:
            continue
        source = str(rec.get("source") or "")
        if source != "official":
            src = staging / "packs" / pid
            if not (src / "pack.json").is_file():
                continue
            dest = user_packs_store.IMPORTED_PACKS_DIR / pid
            if dest.exists():
                shutil.rmtree(dest)
            shutil.copytree(src, dest)
            src_dir = src
        else:
            src_dir = user_packs_store.PACKS_DIR / pid
        has_ext = (src_dir / "extensions").is_dir() and any((src_dir / "extensions").iterdir())
        try:
            uninstall_pack(pid)
        except Exception:
            pass
        install_pack(pid, consent_extensions=consent_extensions)
        restored.append(pid)
        if has_ext:
            extended.append(pid)
    return restored, extended


async def _restore_knowledge(staging: Path) -> list[str]:
    src = staging / "knowledge" / "sources"
    if not src.is_dir():
        return []
    restored = []
    for p in sorted(src.iterdir()):
        if p.is_file() and p.suffix.lower() in ALLOWED_KNOWLEDGE_EXT:
            try:
                content = p.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            await ingest_document(p.name, content)
            restored.append(p.name)
    return restored


def _restore_config(staging: Path) -> bool:
    skel_file = staging / "config" / "provider-skeleton.json"
    if not skel_file.is_file():
        return False
    try:
        skel = json.loads(skel_file.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    providers = skel.get("providers") if isinstance(skel, dict) else None
    if not isinstance(providers, dict):
        return False
    cfg = get_config()
    cur = cfg.setdefault("providers", {})
    for pid, p in providers.items():
        entry = cur.setdefault(pid, {})
        for k in ("baseUrl", "model", "smallFastModel"):
            if p.get(k):
                entry[k] = p[k]
    if isinstance(skel, dict) and skel.get("activeProvider") in cur:
        cfg["activeProvider"] = skel["activeProvider"]
    save_config(cfg)
    return True


def _restore_templates(staging: Path) -> bool:
    tpl = staging / "templates.json"
    if not tpl.is_file():
        return False
    try:
        data = json.loads(tpl.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return False
    items = data if isinstance(data, list) else (data.get("templates") if isinstance(data, dict) else [])
    templates_store.write_templates(None, items if isinstance(items, list) else [])
    return True


def _restore_recipes(staging: Path) -> list[str]:
    src = staging / "fetch-recipes"
    if not src.is_dir():
        return []
    dest = fetch_recipe.RECIPES_DIR
    dest.mkdir(parents=True, exist_ok=True)
    restored = []
    for p in sorted(src.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        if isinstance(data, dict):
            (dest / p.name).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
            restored.append(p.name)
    return restored


async def apply_backup(zip_bytes: bytes, *, consent_extensions: bool) -> dict:
    zf = _open_valid_zip(zip_bytes)
    _read_manifest(zf)
    staging = _staging_dir()
    if staging.exists():
        shutil.rmtree(staging)
    staging.mkdir(parents=True)
    installed_skills: list[str] = []
    installed_packs: list[str] = []
    extended_packs: list[str] = []
    try:
        zf.extractall(staging)
        installed_skills = await _restore_skills(staging)
        installed_packs, extended_packs = _restore_packs(staging, consent_extensions=consent_extensions)
        restored_knowledge = await _restore_knowledge(staging)
        restored_config = _restore_config(staging)
        restored_templates = _restore_templates(staging)
        restored_recipes = _restore_recipes(staging)
    except Exception:
        for sid in installed_skills:
            try:
                delete_skill(None, sid)
            except Exception:
                pass
        for pid in installed_packs:
            try:
                uninstall_pack(pid)
            except Exception:
                pass
        raise
    finally:
        if staging.exists():
            shutil.rmtree(staging)
    return {
        "ok": True,
        "restored": {
            "skills": installed_skills,
            "knowledge": restored_knowledge,
            "packs": installed_packs,
            "config": restored_config,
            "templates": restored_templates,
            "recipes": restored_recipes,
        },
        "consented": extended_packs,
    }






