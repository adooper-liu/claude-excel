"""Run user.* handlers in isolated subprocess with clean env."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from extension_secrets import get_secrets
from user_extension_registry import UserExtension, get_extension

MAX_STDOUT_BYTES = 65536
MAX_STDERR_SNIPPET = 2000
GLOBAL_MAX_TIMEOUT_S = 20.0

_RUN_SEM = asyncio.Semaphore(2)
_RUNTIME_DIR = Path(__file__).resolve().parent / "user_fn_runtime"


def clean_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Build subprocess env without LLM keys."""
    allow = {
        "SYSTEMROOT",
        "SystemRoot",
        "PATH",
        "PATHEXT",
        "TEMP",
        "TMP",
        "TMPDIR",
        "WINDIR",
        "HOME",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "COMSPEC",
        "PYTHONIOENCODING",
        "PYTHONUTF8",
    }
    env: dict[str, str] = {}
    for key in allow:
        val = os.environ.get(key)
        if val:
            env[key] = val
    env["PYTHONPATH"] = str(_RUNTIME_DIR.parent)
    env["CE_USER_FN"] = "1"
    if extra:
        for k, v in extra.items():
            if k.startswith("CE_SECRET_"):
                env[k] = v
    return env


def _error(code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "error": {"code": code, "message": message}}


def _success(data: Any) -> dict[str, Any]:
    return {"ok": True, "data": data}


def _timeout_seconds(ext: UserExtension) -> float:
    declared = ext.manifest.get("timeoutMs", 20000)
    try:
        ms = float(declared)
    except (TypeError, ValueError):
        ms = 20000.0
    return min(ms / 1000.0, GLOBAL_MAX_TIMEOUT_S)


async def run_user_fn(name: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    fn = str(name or "").strip()
    if not fn.startswith("user."):
        return _error("INVALID_NAME", f"非法函数名: {fn}")

    ext = get_extension(fn)
    if ext is None:
        return _error("INVALID_NAME", f"未注册的函数: {fn}")

    if not ext.authorized:
        return _error(
            "NOT_AUTHORIZED",
            "此 pack 的本机函数未授权或能力声明已变化，请重新安装该 pack 并确认。",
        )

    declared_secrets = [str(s) for s in (ext.manifest.get("secrets") or []) if str(s).strip()]
    secret_env = get_secrets(fn, declared_secrets)

    handler = ext.ext_dir / ext.entry
    if not handler.is_file():
        return _error("INVALID_NAME", f"缺少 handler: {ext.entry}")

    stdin_payload = json.dumps(params or {}, ensure_ascii=False)
    env = clean_env(secret_env)

    async with _RUN_SEM:
        try:
            proc = await asyncio.to_thread(
                subprocess.run,
                [sys.executable, str(handler)],
                cwd=str(ext.ext_dir),
                input=stdin_payload,
                capture_output=True,
                text=True,
                timeout=_timeout_seconds(ext),
                env=env,
            )
        except subprocess.TimeoutExpired:
            return _error("TIMEOUT", f"函数 {fn} 执行超时")
        except OSError as exc:
            return _error("NONZERO_EXIT", str(exc))

    if proc.returncode != 0:
        err = (proc.stderr or proc.stdout or "")[:MAX_STDERR_SNIPPET]
        return _error("NONZERO_EXIT", err or f"exit code {proc.returncode}")

    stdout = proc.stdout or ""
    if len(stdout.encode("utf-8")) > MAX_STDOUT_BYTES:
        return _error("INVALID_JSON", "stdout 超过 64KB")

    try:
        data = json.loads(stdout)
    except json.JSONDecodeError:
        return _error("INVALID_JSON", "stdout 必须是单个 JSON 对象")

    if not isinstance(data, dict):
        return _error("INVALID_JSON", "stdout JSON 必须是对象")

    return _success(data)


def verify_clean_env_no_llm_keys() -> bool:
    prev = dict(os.environ)
    try:
        os.environ["DEEPSEEK_API_KEY"] = "test-key-leak"
        os.environ["ANTHROPIC_AUTH_TOKEN"] = "test-token-leak"
        env = clean_env()
    finally:
        os.environ.clear()
        os.environ.update(prev)
    for key in ("DEEPSEEK_API_KEY", "ANTHROPIC_AUTH_TOKEN"):
        if key in env:
            return False
    return True
