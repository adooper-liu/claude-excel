"""server.py — FastAPI backend for Claude Excel Web."""

import os
import uuid
import shutil
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional

import math
import webbrowser
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse, FileResponse, HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import uvicorn

import pandas as pd
from excel_core import describe, profile, clean as excel_clean, compare as excel_compare
from ai_proxy import chat_stream, validate_key
from config_store import save_config, get_config, get_api_key

# ── JSON NaN sanitizer ────────────────────────────────────────────

class NaNResponse(JSONResponse):
    def render(self, content) -> bytes:
        return super().render(_sanitize(content))

def _sanitize(obj):
    if isinstance(obj, float):
        if math.isnan(obj): return None
        if math.isinf(obj): return None
        return obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj

app = FastAPI(title="Claude Excel", version="2.0.0", default_response_class=NaNResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static files ─────────────────────────────────────────────────
FRONTEND_DIR = Path(__file__).parent.parent / "web" / "dist"
ADDIN_DIR = Path(__file__).parent.parent / "addin" / "dist"
ROOT_DIR = Path(__file__).parent.parent

if FRONTEND_DIR.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")

if ADDIN_DIR.exists():
    app.mount("/addin/assets", StaticFiles(directory=ADDIN_DIR / "assets"), name="addin_assets")

UPLOAD_DIR = Path.home() / "claude-excel-web" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Store active file sessions {file_id: path}
_sessions: dict[str, dict] = {}

# ── File cleanup ──────────────────────────────────────────────────

def _cleanup_old_files():
    """Remove files older than 24 hours."""
    cutoff = time.time() - 86400
    for f in UPLOAD_DIR.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink()
    # Also clean _sessions
    stale = [fid for fid, s in _sessions.items()
             if not Path(s["path"]).exists()]
    for fid in stale:
        del _sessions[fid]

# ── API Routes ────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok"}

@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    _cleanup_old_files()
    file_id = uuid.uuid4().hex[:12]
    ext = Path(file.filename).suffix if file.filename else ".xlsx"
    dest = UPLOAD_DIR / f"{file_id}{ext}"
    with open(dest, "wb") as f:
        f.write(await file.read())

    # Get structure
    try:
        info = describe(str(dest))
    except Exception as e:
        dest.unlink()
        raise HTTPException(400, f"Cannot read file: {e}")

    _sessions[file_id] = {"path": str(dest), "name": file.filename}

    return {
        "file_id": file_id,
        "name": file.filename,
        "sheets": info["sheets"],
        "warnings": info.get("warnings", []),
    }

@app.post("/api/describe")
async def api_describe(req: dict):
    file_id = req.get("file_id")
    path = _get_path(file_id)
    return describe(path)

@app.post("/api/profile")
async def api_profile(req: dict):
    file_id = req.get("file_id")
    path = _get_path(file_id)
    columns = req.get("columns")
    return profile(path, columns=columns)

@app.post("/api/clean")
async def api_clean(req: dict):
    file_id = req.get("file_id")
    path = _get_path(file_id)
    ops = req.get("operations")
    out_id = uuid.uuid4().hex[:12]
    out_path = str(UPLOAD_DIR / f"{out_id}_cleaned.xlsx")
    result = excel_clean(path, operations=ops, output_path=out_path)
    _sessions[out_id] = {"path": out_path, "name": f"cleaned_{Path(path).name}"}
    return {**result, "file_id": out_id}

@app.post("/api/compare")
async def api_compare(req: dict):
    path_a = _get_path(req.get("file_id_a"))
    path_b = _get_path(req.get("file_id_b"))
    key = req.get("key_columns")
    return excel_compare(path_a, path_b, key_columns=key)

@app.post("/api/chat")
async def api_chat(req: dict):
    messages = req.get("messages", [])
    system = req.get("system")
    model = req.get("model")
    max_tokens = req.get("max_tokens", 4096)
    stream = req.get("stream", True)
    tools = req.get("tools")

    if not stream:
        # Non-streaming: collect all tokens and return JSON
        result_text = ""
        async for token in chat_stream(messages, system_prompt=system, model=model, max_tokens=max_tokens, tools=tools):
            result_text += token
        return {
            "id": "chat-" + __import__('uuid').uuid4().hex[:8],
            "model": model or "unknown",
            "content": [{"type": "text", "text": result_text}],
            "usage": {"input_tokens": 0, "output_tokens": 0},
        }

    async def event_stream():
        async for token in chat_stream(messages, system_prompt=system, model=model, max_tokens=max_tokens):
            yield f"data: {__import__('json').dumps({'type': 'content_block_delta', 'delta': {'type': 'text_delta', 'text': token}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

@app.post("/api/key/validate")
async def api_validate_key(req: dict):
    api_key = req.get("apiKey", "")
    base_url = req.get("baseUrl")
    if not api_key:
        return {"valid": False, "error": "apiKey required"}
    valid = await validate_key(api_key, base_url)
    return {"valid": valid}

@app.post("/api/key/set")
async def api_set_key(req: dict):
    api_key = req.get("apiKey", "")
    if not api_key:
        raise HTTPException(400, "apiKey required")
    if not api_key.strip().startswith("sk-"):
        raise HTTPException(400, "Invalid key format")
    # Skip validation — let first chat call validate (avoids network issues)
    save_config({k: v for k, v in req.items() if v and k in ("apiKey", "baseUrl", "model", "smallFastModel")})
    return {"ok": True}

# ── Pre-defined Operations (safe — no code execution) ─────────

@app.post("/api/ops/profile")
async def ops_profile(req: dict):
    """Statistical profile + outlier detection."""
    path = _get_path(req.get("file_id"))
    cols = req.get("columns")
    return profile(path, columns=cols)

@app.post("/api/ops/trend")
async def ops_trend(req: dict):
    """Time-series trend detection."""
    path = _get_path(req.get("file_id"))
    date_col = req.get("date_column", "")
    metric_cols = req.get("metric_columns", [])
    if not date_col or not metric_cols:
        raise HTTPException(400, "date_column and metric_columns required")
    df = pd.read_excel(path)
    from excel_core import detect_trends
    result = detect_trends(df, date_col, metric_cols)
    return {"trends": result.to_dict(orient="records")}

@app.post("/api/ops/pivot")
async def ops_pivot(req: dict):
    """Group-by aggregation pivot."""
    path = _get_path(req.get("file_id"))
    group_by = req.get("group_by", [])
    metric_cols = req.get("metric_columns")
    if not group_by:
        raise HTTPException(400, "group_by required")
    df = pd.read_excel(path)
    from excel_core import profile_statistics
    result = profile_statistics(df, metric_cols, group_by=group_by)
    return {"pivot": result.to_dict(orient="records")}

@app.get("/api/skills")
async def api_get_skills():
    """Return all tool definitions from skill manifests."""
    import json, glob as _glob
    tools = []
    skills_dir = Path(__file__).parent.parent / "skills" / "core"
    for mf in sorted(skills_dir.glob("*/manifest.json")):
        try:
            data = json.loads(mf.read_text(encoding="utf-8"))
            tools.extend(data.get("tools", []))
        except Exception:
            pass
    return {"tools": tools, "count": len(tools)}

@app.get("/api/config")
async def api_get_config():
    cfg = get_config()
    pub = {k: v for k, v in cfg.items() if k != "apiKey"}
    pub["hasKey"] = bool(cfg.get("apiKey"))
    return pub

@app.get("/api/download/{file_id}")
async def download(file_id: str):
    path = _get_path(file_id)
    name = _sessions.get(file_id, {}).get("name", Path(path).name)
    return FileResponse(path, filename=name,
                        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

# ── Helpers ────────────────────────────────────────────────────────

def _get_path(file_id: str) -> str:
    if file_id in _sessions and Path(_sessions[file_id]["path"]).exists():
        return _sessions[file_id]["path"]
    # Try glob
    for f in UPLOAD_DIR.iterdir():
        if f.name.startswith(file_id):
            return str(f)
    raise HTTPException(404, f"File not found: {file_id}")

# ── SPA catch-all: serve index.html for non-API routes ────────────

@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    # Root path always serves web frontend
    if not full_path:
        if FRONTEND_DIR.joinpath("index.html").exists():
            return HTMLResponse(FRONTEND_DIR.joinpath("index.html").read_text(encoding="utf-8"))
        return HTMLResponse("<h1>Claude Excel</h1><p>Web frontend not built.</p>")

    # Addin-specific files (only when path matches addin file names)
    ADDIN_FILES = {'taskpane.html', 'taskpane.js', 'commands.html', 'commands.js', 'polyfill.js', 'react.js'}
    if full_path in ADDIN_FILES and ADDIN_DIR.joinpath(full_path).exists():
        return FileResponse(str(ADDIN_DIR / full_path))

    # Web SPA fallback
    if FRONTEND_DIR.joinpath("index.html").exists():
        return HTMLResponse(FRONTEND_DIR.joinpath("index.html").read_text(encoding="utf-8"))
    return HTMLResponse("<h1>Claude Excel</h1><p>Not built.</p>")

# ── Main ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    CERT = ROOT_DIR / "backend" / "cert.pem"
    KEY = ROOT_DIR / "backend" / "key.pem"
    use_ssl = CERT.exists() and KEY.exists()

    print("=" * 50)
    print("  Claude Excel")
    proto = "https" if use_ssl else "http"
    print(f"  {proto}://localhost:8765")
    print("=" * 50)

    if not use_ssl:
        webbrowser.open("http://localhost:8765")
        uvicorn.run(app, host="0.0.0.0", port=8765)
    else:
        webbrowser.open("https://localhost:8765")
        uvicorn.run(app, host="0.0.0.0", port=8765,
                    ssl_keyfile=str(KEY), ssl_certfile=str(CERT))
