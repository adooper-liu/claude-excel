"""server.py — FastAPI backend for the Excel add-in (LLM proxy + static taskpane)."""

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.routing import APIRouter
import uvicorn

from ai_proxy import chat_complete, chat_stream, validate_key
from config_store import save_config, get_config
from templates_store import read_templates, write_templates
from user_skills_store import delete_skill, install_sample_skill, install_skill, list_sample_skills, list_skills
from web_tools import fetch_url_content
from web_ingest import ack_ingest, pending_ingest, push_ingest
from knowledge_store import delete_document, ingest_document, ingest_document_from_path, list_documents, search, status
from fetch_recipe import (
    export_recipe,
    host_from_sheet_name,
    import_recipe,
    list_recipes,
    load_recipe,
    project_targets_for_sheet,
    resolve_project_for_sheet,
    save_recipe,
)
from web_browser import (
    box_select_status,
    cancel_fetch_session,
    capture_fetch_session,
    close_all_sessions,
    highlight_fetch_session,
    picker_status,
    scan_fetch_session,
    start_box_select,
    start_page_picker,
)
from skill_registry import (
    SkillRegistryError,
    addin_skills_dir,
    load_tools,
    validate_backend_skills,
)

ADDIN_DIR = Path(__file__).parent.parent / "addin" / "dist"
ROOT_DIR = Path(__file__).parent.parent


ingest_router = APIRouter()


@ingest_router.post("/api/web-ingest")
async def api_web_ingest(req: dict, request: Request):
    require_loopback(request)
    return push_ingest(req)


@ingest_router.get("/api/web-ingest/pending")
async def api_web_ingest_pending(request: Request):
    require_loopback(request)
    return pending_ingest()


@ingest_router.post("/api/web-ingest/ack")
async def api_web_ingest_ack(req: dict, request: Request):
    require_loopback(request)
    return ack_ingest(str((req or {}).get("id") or ""))


@ingest_router.get("/api/fetch-recipe")
async def api_fetch_recipe_get(request: Request, url: str = ""):
    require_loopback(request)
    return export_recipe(url)


@ingest_router.post("/api/fetch-recipe")
async def api_fetch_recipe_post(req: dict, request: Request):
    require_loopback(request)
    data = req if isinstance(req, dict) else {}
    if data.get("recipe"):
        return import_recipe(data.get("recipe"))
    url = str(data.get("url") or "")
    recipe = load_recipe(url)
    if url:
        recipe["url"] = url
    return save_recipe(recipe)


@ingest_router.get("/api/fetch-recipe/list")
async def api_fetch_recipe_list(request: Request):
    require_loopback(request)
    return {"recipes": list_recipes()}


@ingest_router.get("/api/fetch-recipe/project")
async def api_fetch_recipe_project(
    request: Request,
    url: str = "",
    sheet: str = "",
    targets: str = "",
):
    require_loopback(request)
    page_url = str(url or "").strip()
    if not page_url and sheet:
        host = host_from_sheet_name(sheet)
        if host:
            page_url = "https://" + host + "/"
    target_list = [t.strip() for t in str(targets or "").split("/") if t.strip()] or None
    hit = resolve_project_for_sheet(sheet, page_url, target_list) if (sheet or page_url) else None
    default_targets = project_targets_for_sheet(sheet, page_url)
    return {
        "url": page_url,
        "sheet": sheet,
        "project": hit,
        "targets": default_targets,
    }


@ingest_router.get("/api/knowledge")
async def api_knowledge_list(request: Request):
    require_loopback(request)
    return {"documents": list_documents(), "status": status()}


@ingest_router.post("/api/knowledge")
async def api_knowledge_ingest(req: dict, request: Request):
    require_loopback(request)
    filename = str((req or {}).get("filename") or (req or {}).get("name") or "note.md")
    content = str((req or {}).get("content") or (req or {}).get("text") or "")
    if not content.strip():
        raise HTTPException(400, "content required")
    try:
        doc = await ingest_document(filename, content)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"document": doc, "status": status()}


@ingest_router.post("/api/knowledge/from-path")
async def api_knowledge_from_path(req: dict, request: Request):
    require_loopback(request)
    path = str((req or {}).get("path") or (req or {}).get("filePath") or "")
    try:
        doc = await ingest_document_from_path(path)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"document": doc, "status": status()}


@ingest_router.post("/api/knowledge/search")
async def api_knowledge_search(req: dict, request: Request):
    require_loopback(request)
    query = str((req or {}).get("query") or "")
    top_k = (req or {}).get("topK") or (req or {}).get("top_k") or 5
    doc_id = str((req or {}).get("docId") or (req or {}).get("doc_id") or "") or None
    try:
        return await search(query, int(top_k), doc_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@ingest_router.delete("/api/knowledge/{doc_id}")
async def api_knowledge_delete(doc_id: str, request: Request):
    require_loopback(request)
    try:
        delete_document(doc_id)
    except FileNotFoundError:
        raise HTTPException(404, "document not found")
    return {"ok": True, "status": status()}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        validate_backend_skills(ROOT_DIR)
    except SkillRegistryError as exc:
        raise SystemExit(str(exc)) from exc
    loopback = uvicorn.Server(
        uvicorn.Config(ingest_app, host="127.0.0.1", port=8766, log_level="warning")
    )
    task = asyncio.create_task(loopback.serve())
    print("  extension ingest http://127.0.0.1:8766")
    yield
    loopback.should_exit = True
    task.cancel()
    await close_all_sessions()


app = FastAPI(title="Claude Excel", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://localhost:3000",
        "http://localhost:3000",
        "https://localhost:8765",
    ],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

ingest_app = FastAPI(title="Claude Excel ingest")
ingest_app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@ingest_router.get("/extension/picker.js")
async def api_extension_picker_js():
    path = ROOT_DIR / "extension" / "picker.js"
    if not path.is_file():
        raise HTTPException(404, "picker.js not found")
    return FileResponse(
        str(path),
        media_type="text/javascript; charset=utf-8",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


app.include_router(ingest_router)
ingest_app.include_router(ingest_router)


def _client_host(request: Request) -> str:
    host = (request.client.host if request.client else "") or ""
    host = host.split("%")[0]
    if host.lower().startswith("::ffff:"):
        host = host[7:]
    return host


def require_loopback(request: Request) -> None:
    host = _client_host(request)
    if host in ("127.0.0.1", "::1") or host.startswith("127."):
        return
    raise HTTPException(403, "本机服务，仅允许本机访问")


if ADDIN_DIR.joinpath("assets").exists():
    app.mount("/assets", StaticFiles(directory=ADDIN_DIR / "assets"), name="assets")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/chat")
async def api_chat(req: dict, request: Request):
    require_loopback(request)
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
async def api_set_key(req: dict, request: Request):
    require_loopback(request)
    api_key = req.get("apiKey", "")
    if not api_key:
        raise HTTPException(400, "apiKey required")
    if not api_key.strip().startswith("sk-"):
        raise HTTPException(400, "Invalid key format")
    valid = await validate_key(api_key.strip(), req.get("baseUrl"))
    if not valid:
        raise HTTPException(400, "Key 校验失败。请确认 Key 和 Base URL。")
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
async def api_put_templates(req: dict, request: Request):
    require_loopback(request)
    items = req.get("templates")
    if not isinstance(items, list):
        raise HTTPException(400, "templates must be a list")
    return {"templates": write_templates(None, items)}


@app.get("/api/user-skills")
async def api_list_user_skills():
    return {"skills": list_skills(), "samples": list_sample_skills()}


@app.get("/api/user-skills/samples")
async def api_list_sample_skills():
    return {"samples": list_sample_skills()}


@app.post("/api/user-skills/install-sample")
async def api_install_sample_skill(req: dict, request: Request):
    require_loopback(request)
    sample_id = str((req or {}).get("id") or "").strip()
    if not sample_id:
        raise HTTPException(400, "id required")
    try:
        skill = install_sample_skill(sample_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"skill": skill}


@app.post("/api/user-skills")
async def api_install_user_skill(req: dict, request: Request):
    require_loopback(request)
    markdown = req.get("markdown") or req.get("content") or ""
    if not str(markdown).strip():
        raise HTTPException(400, "markdown required")
    try:
        skill = install_skill(None, str(markdown))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"skill": skill}


@app.post("/api/web-fetch")
async def api_web_fetch(req: dict, request: Request):
    require_loopback(request)
    url = req.get("url") or ""
    as_rows = bool(req.get("asRows") or req.get("as_rows"))
    user = req.get("username") or req.get("user") or ""
    password = req.get("password") or ""
    return await fetch_url_content(
        str(url),
        str(user) or None,
        str(password) or None,
        as_rows=as_rows,
        browser=bool(req.get("browser")),
    )


@app.post("/api/web-fetch-scan")
async def api_web_fetch_scan(req: dict, request: Request):
    require_loopback(request)
    return await scan_fetch_session(str(req.get("sessionId") or ""))


@app.post("/api/web-fetch-highlight")
async def api_web_fetch_highlight(req: dict, request: Request):
    require_loopback(request)
    try:
        idx = int(req.get("gridIndex") if req.get("gridIndex") is not None else 0)
    except (TypeError, ValueError):
        idx = 0
    return await highlight_fetch_session(str(req.get("sessionId") or ""), idx)


@app.post("/api/web-fetch-capture")
async def api_web_fetch_capture(req: dict, request: Request):
    require_loopback(request)
    raw_idx = req.get("gridIndex")
    try:
        idx = None if raw_idx in (None, "") else int(raw_idx)
    except (TypeError, ValueError):
        idx = None
    return await capture_fetch_session(
        str(req.get("sessionId") or ""),
        idx,
        str(req.get("rowFrom") or "") or None,
        str(req.get("rowTo") or "") or None,
        str(req.get("colFrom") or "") or None,
        str(req.get("colTo") or "") or None,
        live=bool(req.get("live") or req.get("append")),
    )


@app.post("/api/web-fetch-cancel")
async def api_web_fetch_cancel(req: dict, request: Request):
    require_loopback(request)
    return await cancel_fetch_session(str(req.get("sessionId") or ""))


@app.post("/api/web-fetch-box")
async def api_web_fetch_box(req: dict, request: Request):
    require_loopback(request)
    return await start_box_select(str(req.get("sessionId") or ""))


@app.post("/api/web-fetch-box-status")
async def api_web_fetch_box_status(req: dict, request: Request):
    require_loopback(request)
    return await box_select_status(str(req.get("sessionId") or ""))


@app.post("/api/web-fetch-picker")
async def api_web_fetch_picker(req: dict, request: Request):
    require_loopback(request)
    mode = str((req or {}).get("mode") or "").strip() or None
    return await start_page_picker(str(req.get("sessionId") or ""), mode)


@app.post("/api/web-fetch-picker-status")
async def api_web_fetch_picker_status(req: dict, request: Request):
    require_loopback(request)
    return await picker_status(str(req.get("sessionId") or ""))


@app.delete("/api/user-skills/{skill_id}")
async def api_delete_user_skill(skill_id: str, request: Request):
    require_loopback(request)
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
    print("  extension ingest http://127.0.0.1:8766")
    print("=" * 50)
    if use_ssl:
        uvicorn.run(
            app,
            host="127.0.0.1",
            port=8765,
            ssl_keyfile=str(KEY),
            ssl_certfile=str(CERT),
        )
    else:
        uvicorn.run(app, host="127.0.0.1", port=8765)
