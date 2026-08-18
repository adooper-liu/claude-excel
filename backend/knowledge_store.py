"""Local vector RAG under ~/.claude-excel-web/knowledge/."""

from __future__ import annotations

import json
import math
import re
import sqlite3
import uuid
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from config_store import CONFIG_DIR, get_api_key, get_base_url, get_config

KNOWLEDGE_DIR = CONFIG_DIR / "knowledge"
SOURCES_DIR = KNOWLEDGE_DIR / "sources"
INDEX_DB = KNOWLEDGE_DIR / "index.sqlite"

MAX_DOCS = 100
MAX_DOC_BYTES = 2 * 1024 * 1024
CHUNK_SIZE = 900
CHUNK_OVERLAP = 120
LOCAL_EMBED_DIM = 384
ALLOWED_EXT = {".md", ".markdown", ".txt", ".csv"}

# 本地向量算法版本。改 local_embed 需 +1，search 检测到旧版本会重建全部 chunk 向量。
EMBED_VERSION = 2


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _ensure_dirs() -> None:
    KNOWLEDGE_DIR.mkdir(parents=True, exist_ok=True)
    SOURCES_DIR.mkdir(parents=True, exist_ok=True)


def _connect() -> sqlite3.Connection:
    _ensure_dirs()
    conn = sqlite3.connect(INDEX_DB)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            bytes INTEGER NOT NULL,
            chunk_count INTEGER NOT NULL DEFAULT 0,
            indexed_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS chunks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            doc_id TEXT NOT NULL,
            chunk_index INTEGER NOT NULL,
            text TEXT NOT NULL,
            embedding TEXT NOT NULL,
            FOREIGN KEY(doc_id) REFERENCES documents(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id)")
    conn.commit()
    return conn


def _embed_version(conn: sqlite3.Connection) -> int:
    row = conn.execute("SELECT value FROM meta WHERE key = 'embed_version'").fetchone()
    try:
        return int(row["value"]) if row else 0
    except (TypeError, ValueError):
        return 0


def _set_embed_version(conn: sqlite3.Connection, version: int) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO meta (key, value) VALUES ('embed_version', ?)",
        (str(version),),
    )


async def _reembed_all(conn: sqlite3.Connection) -> None:
    """本地向量算法升级时重建全部 chunk 向量（小库，一次性；API 模式按配置走）。"""
    rows = conn.execute("SELECT id, text FROM chunks").fetchall()
    if rows:
        vectors, _mode = await embed_texts([str(r["text"]) for r in rows])
        for row, emb in zip(rows, vectors):
            conn.execute(
                "UPDATE chunks SET embedding = ? WHERE id = ?",
                (json.dumps(emb), row["id"]),
            )
    _set_embed_version(conn, EMBED_VERSION)
    conn.commit()


def _safe_name(name: str) -> str:
    base = Path(str(name or "").strip()).name
    if not base or base in (".", "..") or re.search(r"[\\/:]", base):
        raise ValueError("文件名无效")
    ext = Path(base).suffix.lower()
    if ext not in ALLOWED_EXT:
        raise ValueError("仅支持 .md / .txt / .markdown / .csv")
    return base


def chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    raw = str(text or "").replace("\r\n", "\n").strip()
    if not raw:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", raw) if p.strip()]
    out: list[str] = []
    buf = ""
    for para in paras:
        if len(para) > chunk_size:
            if buf:
                out.append(buf)
                buf = ""
            step = max(1, chunk_size - overlap)
            for i in range(0, len(para), step):
                out.append(para[i : i + chunk_size])
            continue
        candidate = (buf + "\n\n" + para).strip() if buf else para
        if len(candidate) <= chunk_size:
            buf = candidate
        else:
            if buf:
                out.append(buf)
            buf = para
    if buf:
        out.append(buf)
    return out


def _stable_hash(gram: str) -> int:
    """进程间稳定的哈希。Python 内置 hash() 对字符串是随机种子，跨进程/重启不一致，
    会让存进 index.sqlite 的向量在后端重启后对不上新查询。改用 crc32。"""
    return zlib.crc32(gram.encode("utf-8"))


def _n_grams(text: str) -> set[str]:
    """小写、合并空白后的 2/3-gram 集合，用于词法匹配。"""
    t = re.sub(r"\s+", " ", str(text or "").lower()).strip()
    out: set[str] = set()
    for n in (2, 3):
        for i in range(max(0, len(t) - n + 1)):
            out.add(t[i : i + n])
    return out


def _lexical_overlap(query_grams: set[str], chunk_text: str) -> float:
    """查询 n-gram 在 chunk 文本中的覆盖率（0..1）。精确词命中（尤其短中文查询）提权。"""
    if not query_grams:
        return 0.0
    chunk_grams = _n_grams(chunk_text)
    return len(query_grams & chunk_grams) / len(query_grams)


def local_embed(text: str, dim: int = LOCAL_EMBED_DIM) -> list[float]:
    vec = [0.0] * dim
    t = re.sub(r"\s+", " ", str(text or "").lower()).strip()
    if not t:
        return vec
    for n in (2, 3):
        for i in range(max(0, len(t) - n + 1)):
            gram = t[i : i + n]
            h = _stable_hash(gram) % dim
            vec[h] += 1.0
    # 次线性词频：log1p 压住高频 n-gram 的支配，让稀有特征更有区分度
    vec = [math.log1p(v) for v in vec]
    norm = math.sqrt(sum(x * x for x in vec)) or 1.0
    return [x / norm for x in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b))


async def embed_texts(texts: list[str]) -> tuple[list[list[float]], str]:
    """Return embeddings and mode: api | local."""
    cleaned = [str(t or "").strip() for t in texts]
    if not cleaned:
        return [], "local"
    cfg = get_config()
    model = str(cfg.get("embeddingModel") or "").strip()
    key = get_api_key()
    if model and key:
        base = get_base_url().rstrip("/")
        url = base + "/v1/embeddings"
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                resp = await client.post(
                    url,
                    headers={
                        "content-type": "application/json",
                        "authorization": f"Bearer {key}",
                        "x-api-key": key,
                    },
                    json={"model": model, "input": cleaned},
                )
            if resp.status_code == 200:
                data = resp.json()
                rows = data.get("data") or []
                if isinstance(rows, list) and len(rows) == len(cleaned):
                    vectors: list[list[float]] = []
                    for row in rows:
                        emb = row.get("embedding") if isinstance(row, dict) else None
                        if not isinstance(emb, list) or not emb:
                            raise ValueError("empty embedding")
                        vectors.append([float(x) for x in emb])
                    return vectors, "api"
        except Exception:
            pass
    return [local_embed(t) for t in cleaned], "local"


def list_documents(root: Path | None = None) -> list[dict[str, Any]]:
    conn = _connect()
    try:
        rows = conn.execute(
            "SELECT id, name, path, bytes, chunk_count, indexed_at FROM documents ORDER BY indexed_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def status() -> dict[str, Any]:
    docs = list_documents()
    chunk_count = sum(int(d.get("chunk_count") or 0) for d in docs)
    cfg = get_config()
    model = str(cfg.get("embeddingModel") or "").strip()
    mode = "api" if model and get_api_key() else "local"
    return {
        "docCount": len(docs),
        "chunkCount": chunk_count,
        "embeddingMode": mode,
        "embeddingModel": model or None,
        "maxDocs": MAX_DOCS,
        "maxDocBytes": MAX_DOC_BYTES,
    }


async def ingest_document_from_path(file_path: str) -> dict[str, Any]:
    raw_path = str(file_path or "").strip().strip('"').strip("'")
    if not raw_path:
        raise ValueError("请填写本机文件路径")
    path = Path(raw_path).expanduser()
    try:
        path = path.resolve()
    except OSError as exc:
        raise ValueError("路径无效") from exc
    if not path.is_file():
        raise ValueError("文件不存在：" + str(path))
    if path.suffix.lower() not in ALLOWED_EXT:
        raise ValueError("仅支持 .md / .txt / .markdown / .csv")
    try:
        content = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("文件须为 UTF-8 文本") from exc
    return await ingest_document(path.name, content)


async def ingest_document(filename: str, content: str, root: Path | None = None) -> dict[str, Any]:
    name = _safe_name(filename)
    raw = str(content or "")
    data = raw.encode("utf-8")
    if len(data) > MAX_DOC_BYTES:
        raise ValueError(f"单文件不超过 {MAX_DOC_BYTES // 1024 // 1024}MB")
    chunks = chunk_text(raw)
    if not chunks:
        raise ValueError("文件没有可索引的正文")

    base = root or SOURCES_DIR
    _ensure_dirs()
    dest: Path | None = None
    conn = _connect()
    try:
        existing = conn.execute("SELECT COUNT(*) AS c FROM documents").fetchone()
        doc_count = int(existing["c"] if existing else 0)
        doc_id = uuid.uuid4().hex[:12]
        dest = base / f"{doc_id}_{name}"
        dest.write_text(raw.replace("\r\n", "\n"), encoding="utf-8")

        old = conn.execute("SELECT id, path FROM documents WHERE name = ?", (name,)).fetchone()
        if old:
            _delete_doc(conn, str(old["id"]), str(old["path"]))
        elif doc_count >= MAX_DOCS:
            raise ValueError(f"最多索引 {MAX_DOCS} 个文档")

        vectors, mode = await embed_texts(chunks)
        indexed_at = _now_iso()
        conn.execute(
            "INSERT INTO documents (id, name, path, bytes, chunk_count, indexed_at) VALUES (?, ?, ?, ?, ?, ?)",
            (doc_id, name, str(dest), len(data), len(chunks), indexed_at),
        )
        for i, (text, emb) in enumerate(zip(chunks, vectors)):
            conn.execute(
                "INSERT INTO chunks (doc_id, chunk_index, text, embedding) VALUES (?, ?, ?, ?)",
                (doc_id, i, text, json.dumps(emb)),
            )
        _set_embed_version(conn, EMBED_VERSION)
        conn.commit()
        return {
            "id": doc_id,
            "name": name,
            "bytes": len(data),
            "chunkCount": len(chunks),
            "indexedAt": indexed_at,
            "embeddingMode": mode,
        }
    except Exception:
        conn.rollback()
        if dest is not None and dest.exists():
            dest.unlink(missing_ok=True)
        raise
    finally:
        conn.close()


def _delete_doc(conn: sqlite3.Connection, doc_id: str, path: str) -> None:
    conn.execute("DELETE FROM chunks WHERE doc_id = ?", (doc_id,))
    conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
    try:
        Path(path).unlink(missing_ok=True)
    except OSError:
        pass


def delete_document(doc_id: str) -> None:
    conn = _connect()
    try:
        row = conn.execute("SELECT id, path FROM documents WHERE id = ?", (doc_id,)).fetchone()
        if not row:
            raise FileNotFoundError(doc_id)
        _delete_doc(conn, str(row["id"]), str(row["path"]))
        conn.commit()
    finally:
        conn.close()


async def search(query: str, top_k: int = 5, doc_id: str | None = None) -> dict[str, Any]:
    q = str(query or "").strip()
    if not q:
        raise ValueError("query required")
    k = max(1, min(int(top_k or 5), 12))

    conn = _connect()
    try:
        if _embed_version(conn) != EMBED_VERSION:
            await _reembed_all(conn)
        if doc_id:
            rows = conn.execute(
                "SELECT c.doc_id, c.chunk_index, c.text, c.embedding, d.name "
                "FROM chunks c JOIN documents d ON d.id = c.doc_id WHERE c.doc_id = ?",
                (doc_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT c.doc_id, c.chunk_index, c.text, c.embedding, d.name "
                "FROM chunks c JOIN documents d ON d.id = c.doc_id"
            ).fetchall()
        if not rows:
            return {"query": q, "embeddingMode": "local", "hits": []}

        q_vecs, mode = await embed_texts([q])
        q_vec = q_vecs[0] if q_vecs else local_embed(q)
        q_grams = _n_grams(q)
        scored: list[tuple[float, dict[str, Any]]] = []
        for row in rows:
            emb = json.loads(str(row["embedding"]))
            vec_score = cosine(q_vec, emb)
            # 词面覆盖 + 向量：精确词命中（尤其短中文查询）提权
            lex = _lexical_overlap(q_grams, str(row["text"]))
            score = vec_score * 0.6 + lex * 0.4
            scored.append(
                (
                    score,
                    {
                        "docId": row["doc_id"],
                        "docName": row["name"],
                        "chunkIndex": int(row["chunk_index"]),
                        "score": round(score, 4),
                        "text": str(row["text"]),
                    },
                )
            )
        scored.sort(key=lambda x: x[0], reverse=True)
        hits = [item for _, item in scored[:k]]
        return {"query": q, "embeddingMode": mode, "hits": hits}
    finally:
        conn.close()
