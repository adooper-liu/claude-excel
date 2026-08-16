"""Scan ~/.claude-excel-web/packs/*/extensions/*/manifest.json for user.* tools."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config_store import CONFIG_DIR

RUNTIME_PACKS_DIR = CONFIG_DIR / "packs"
INSTALLED_PACKS_FILE = CONFIG_DIR / "installed_packs.json"

NAME_RE = re.compile(r"^user\.[a-z][a-z0-9_]*$")
MAX_EXTENSIONS = 20


@dataclass(frozen=True)
class UserExtension:
    name: str
    description: str
    pack_id: str
    ext_dir: Path
    manifest: dict[str, Any]
    authorized: bool

    @property
    def entry(self) -> str:
        return str(self.manifest.get("entry") or "handler.py")


def pack_capability_hash(manifests: list[dict[str, Any]]) -> str:
    """Hash per-pack name+network+secrets; name kept so renaming an extension also re-triggers consent."""
    items = []
    for m in sorted(manifests, key=lambda x: str(x.get("name") or "")):
        items.append(
            {
                "name": str(m.get("name") or ""),
                "network": bool(m.get("network")),
                "secrets": sorted(str(s) for s in (m.get("secrets") or []) if str(s).strip()),
            }
        )
    raw = json.dumps(items, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _read_installed_records() -> list[dict[str, Any]]:
    if not INSTALLED_PACKS_FILE.is_file():
        return []
    try:
        data = json.loads(INSTALLED_PACKS_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    if not isinstance(data, list):
        return []
    return [r for r in data if isinstance(r, dict)]


def _installed_record(pack_id: str) -> dict[str, Any] | None:
    for rec in _read_installed_records():
        if str(rec.get("id") or "").strip() == pack_id:
            return rec
    return None


def _pack_authorized(pack_id: str, current_hash: str) -> bool:
    rec = _installed_record(pack_id)
    if not rec:
        return False
    stored = str(rec.get("capabilityHash") or "").strip()
    consented = str(rec.get("consentedAt") or "").strip()
    if not stored or not consented:
        return False
    return stored == current_hash


def _validate_manifest(data: dict[str, Any], ext_dir: Path) -> dict[str, Any]:
    name = str(data.get("name") or "").strip()
    if not NAME_RE.match(name):
        raise ValueError(f"非法函数名: {name!r}")
    entry = str(data.get("entry") or "handler.py").strip()
    if not entry or "/" in entry or "\\" in entry or ".." in entry:
        raise ValueError(f"非法 entry: {entry!r}")
    handler = ext_dir / entry
    if not handler.is_file():
        raise ValueError(f"缺少 handler: {entry}")
    if "description" not in data:
        raise ValueError("manifest 需要 description")
    if data.get("returns") != "json":
        raise ValueError("returns 必须为 json")
    if "network" not in data:
        raise ValueError("manifest 需要 network 布尔值")
    secrets = data.get("secrets") or []
    if secrets is not None and not isinstance(secrets, list):
        raise ValueError("secrets 必须是数组")
    timeout_ms = data.get("timeoutMs", 20000)
    if not isinstance(timeout_ms, (int, float)) or timeout_ms <= 0:
        raise ValueError("timeoutMs 必须是正数")
    return data


def _scan_extension_dirs() -> list[tuple[str, Path]]:
    if not RUNTIME_PACKS_DIR.is_dir():
        return []
    out: list[tuple[str, Path]] = []
    for pack_dir in sorted(RUNTIME_PACKS_DIR.iterdir()):
        if not pack_dir.is_dir():
            continue
        ext_root = pack_dir / "extensions"
        if not ext_root.is_dir():
            continue
        pack_id = pack_dir.name
        for ext_dir in sorted(ext_root.iterdir()):
            if not ext_dir.is_dir():
                continue
            mf = ext_dir / "manifest.json"
            if mf.is_file():
                out.append((pack_id, ext_dir))
    return out


def list_extensions() -> list[UserExtension]:
    """Return registered user.* extensions from runtime pack dir."""
    scanned: list[tuple[str, Path, dict[str, Any]]] = []
    for pack_id, ext_dir in _scan_extension_dirs():
        mf = ext_dir / "manifest.json"
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("manifest 必须是对象")
            data = _validate_manifest(data, ext_dir)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        scanned.append((pack_id, ext_dir, data))

    pack_manifests: dict[str, list[dict[str, Any]]] = {}
    for pack_id, _ext_dir, data in scanned:
        pack_manifests.setdefault(pack_id, []).append(data)

    pack_hashes = {
        pid: pack_capability_hash(manifests) for pid, manifests in pack_manifests.items()
    }
    pack_auth = {
        pid: _pack_authorized(pid, pack_hashes[pid]) for pid in pack_hashes
    }

    by_name: dict[str, UserExtension] = {}
    for pack_id, ext_dir, data in scanned:
        name = str(data["name"])
        ext = UserExtension(
            name=name,
            description=str(data.get("description") or name),
            pack_id=pack_id,
            ext_dir=ext_dir,
            manifest=data,
            authorized=pack_auth.get(pack_id, False),
        )
        by_name[name] = ext

    return sorted(by_name.values(), key=lambda e: e.name)


def get_extension(name: str) -> UserExtension | None:
    fn = str(name or "").strip()
    if not fn:
        return None
    for ext in list_extensions():
        if ext.name == fn:
            return ext
    return None


def list_catalog_extensions(pack_dir: Path) -> list[dict[str, Any]]:
    """List extensions declared in a sample pack directory (for install UI)."""
    ext_root = pack_dir / "extensions"
    if not ext_root.is_dir():
        return []
    out: list[dict[str, Any]] = []
    for ext_dir in sorted(ext_root.iterdir()):
        if not ext_dir.is_dir():
            continue
        mf = ext_dir / "manifest.json"
        if not mf.is_file():
            continue
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                continue
            data = _validate_manifest(data, ext_dir)
        except (OSError, json.JSONDecodeError, ValueError):
            continue
        out.append(
            {
                "id": ext_dir.name,
                "name": data["name"],
                "description": str(data.get("description") or data["name"]),
                "network": bool(data.get("network")),
                "secrets": list(data.get("secrets") or []),
            }
        )
    return out
