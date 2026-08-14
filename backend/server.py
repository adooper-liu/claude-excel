"""server.py — FastAPI backend for the Excel add-in (LLM proxy + static taskpane)."""

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
import uvicorn

from ai_proxy import chat_complete, chat_stream, validate_key
from config_store import save_config, get_config
from templates_store import read_templates, write_templates
from user_skills_store import delete_skill, install_skill, list_skills
from web_tools import fetch_url_content
from skill_registry import (
    SkillRegistryError,
    addin_skills_dir,
    load_tools,
    validate_backend_skills,
)

ADDIN_DIR = Path(__file__).parent.parent / "addin" / "dist"
ROOT_DIR = Path(__file__).parent.parent


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        validate_backend_skills(ROOT_DIR)
    except SkillRegistryError as exc:
        raise SystemExit(str(exc)) from exc
    yield


app = FastAPI(title="Claude Excel", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://localhost:3000"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


if ADDIN_DIR.joinpath("assets").exists():
    app.mount("/assets", StaticFiles(directory=ADDIN_DIR / "assets"), name="assets")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/chat")
async def api_chat(req: dict):
    messages = req.get("messages", [])
    system = req.get("system")
    model = req.get("model")
    max_tokens = req.get("max_tokens", 4096)
    stream = req.get("stream", True)
    tools = req.get("tools")

    if not stream:
        return await chat_complete(
            messages,
            system_prompt=system,
            model=model,
            max_tokens=max_tokens,
            tools=tools,
        )

    async def event_stream():
        async for token in chat_stream(
            messages,
            system_prompt=system,
            model=model,
            max_tokens=max_tokens,
            tools=tools,
        ):
            payload = {
                "type": "content_block_delta",
                "delta": {"type": "text_delta", "text": token},
            }
            yield "data: " + json.dumps(payload) + "\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
    save_config(
        {
            k: v
            for k, v in req.items()
            if v and k in ("apiKey", "baseUrl", "model", "smallFastModel")
        }
    )
    return {"ok": True}


@app.get("/api/skills")
async def api_get_skills():
    tools = load_tools(addin_skills_dir(ROOT_DIR))
    return {"tools": tools, "count": len(tools)}


@app.get("/api/config")
async def api_get_config():
    cfg = get_config()
    pub = {k: v for k, v in cfg.items() if k != "apiKey"}
    pub["hasKey"] = bool(cfg.get("apiKey"))
    return pub


@app.get("/api/templates")
async def api_get_templates():
    return {"templates": read_templates()}


@app.put("/api/templates")
async def api_put_templates(req: dict):
    items = req.get("templates")
    if not isinstance(items, list):
        raise HTTPException(400, "templates must be a list")
    return {"templates": write_templates(None, items)}


@app.get("/api/user-skills")
async def api_list_user_skills():
    return {"skills": list_skills()}


@app.post("/api/user-skills")
async def api_install_user_skill(req: dict):
    markdown = req.get("markdown") or req.get("content") or ""
    if not str(markdown).strip():
        raise HTTPException(400, "markdown required")
    try:
        skill = install_skill(None, str(markdown))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"skill": skill}


@app.post("/api/web-fetch")
async def api_web_fetch(req: dict):
    url = req.get("url") or ""
    return await fetch_url_content(str(url))


@app.delete("/api/user-skills/{skill_id}")
async def api_delete_user_skill(skill_id: str):
    try:
        delete_skill(None, skill_id)
    except FileNotFoundError:
        raise HTTPException(404, "skill not found")
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True}


ADDIN_FILES = {
    "taskpane.html",
    "taskpane.js",
    "commands.html",
    "commands.js",
    "polyfill.js",
    "react.js",
}


@app.get("/{full_path:path}")
async def serve_addin(full_path: str):
    if full_path in ADDIN_FILES and ADDIN_DIR.joinpath(full_path).exists():
        return FileResponse(
            str(ADDIN_DIR / full_path),
            headers={
                "Cache-Control": "no-store, no-cache, must-revalidate",
                "Pragma": "no-cache",
            },
        )
    raise HTTPException(404, "Not found")


if __name__ == "__main__":
    CERT = ROOT_DIR / "backend" / "cert.pem"
    KEY = ROOT_DIR / "backend" / "key.pem"
    use_ssl = CERT.exists() and KEY.exists()
    proto = "https" if use_ssl else "http"
    print("=" * 50)
    print("  Claude Excel (Excel add-in backend)")
    print(f"  {proto}://localhost:8765")
    print("=" * 50)
    if use_ssl:
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=8765,
            ssl_keyfile=str(KEY),
            ssl_certfile=str(CERT),
        )
    else:
        uvicorn.run(app, host="0.0.0.0", port=8765)
