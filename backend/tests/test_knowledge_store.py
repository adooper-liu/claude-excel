"""Local knowledge RAG store."""

import asyncio
import json
import subprocess
import sys
from pathlib import Path

import pytest

from knowledge_store import (
    _connect,
    chunk_text,
    cosine,
    delete_document,
    ingest_document,
    ingest_document_from_path,
    list_documents,
    local_embed,
    search,
)


@pytest.fixture
def kb_root(tmp_path, monkeypatch):
    root = tmp_path / "knowledge"
    sources = root / "sources"
    sources.mkdir(parents=True)
    db = root / "index.sqlite"
    monkeypatch.setattr("knowledge_store.KNOWLEDGE_DIR", root)
    monkeypatch.setattr("knowledge_store.SOURCES_DIR", sources)
    monkeypatch.setattr("knowledge_store.INDEX_DB", db)
    return root


def test_chunk_text_splits_long_paragraph():
    text = "段落A。" * 200
    chunks = chunk_text(text, chunk_size=120, overlap=20)
    assert len(chunks) >= 2
    assert all(len(c) <= 120 for c in chunks)


def test_local_embed_normalized():
    a = local_embed("HS 编码 归类")
    b = local_embed("HS 编码 归类")
    assert len(a) == len(b)
    assert abs(cosine(a, b) - 1.0) < 1e-6


def test_ingest_and_search(kb_root):
    async def run():
        doc = await ingest_document(
            "policy.md",
            "# IOSS\n\n欧盟 IOSS 适用于 150 欧元以下直邮。\n\n# 税率\n\n德国 VAT 19%。",
        )
        assert doc["chunkCount"] >= 1
        assert len(list_documents()) == 1

        hit = await search("IOSS 直邮 门槛")
        assert hit["hits"]
        assert "IOSS" in hit["hits"][0]["text"]

        delete_document(doc["id"])
        assert list_documents() == []

    asyncio.run(run())


def test_replaces_same_filename(kb_root):
    async def run():
        first = await ingest_document("note.txt", "版本一 alpha beta")
        second = await ingest_document("note.txt", "版本二 gamma delta")
        docs = list_documents()
        assert len(docs) == 1
        assert docs[0]["id"] == second["id"]
        assert first["id"] != second["id"]
        hit = await search("gamma")
        assert hit["hits"] and "gamma" in hit["hits"][0]["text"]

    asyncio.run(run())


def test_ingest_from_path(kb_root, tmp_path):
    src = tmp_path / "handbook.md"
    src.write_text("# 手册\n\n退运须在 7 日内申报。", encoding="utf-8")

    async def run():
        doc = await ingest_document_from_path(str(src))
        assert doc["chunkCount"] >= 1
        hit = await search("退运")
        assert hit["hits"] and "退运" in hit["hits"][0]["text"]

    asyncio.run(run())


def test_local_embed_stable_across_processes():
    """内置 hash() 对字符串是进程随机种子，会让存储向量跨重启失效；crc32 必须稳定。"""
    backend_dir = str(Path(__file__).resolve().parent.parent)
    code = (
        "import json; "
        "from knowledge_store import local_embed; "
        "print(json.dumps(local_embed('HS 编码 归类')))"
    )
    out = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=backend_dir,
    )
    assert out.returncode == 0, out.stderr
    child = json.loads(out.stdout)
    assert child == local_embed("HS 编码 归类")


def test_reembeds_on_embed_version_change(kb_root):
    """算法版本升级后，旧库在下次 search 自动重建向量，不用重传文档。"""

    async def run():
        await ingest_document("v.md", "关税 税率 退运 申报")
        conn = _connect()
        conn.execute("UPDATE meta SET value = '1' WHERE key = 'embed_version'")
        conn.commit()
        conn.close()
        hit = await search("关税")
        assert hit["hits"] and "关税" in hit["hits"][0]["text"]
        # search 内部已重嵌并更新版本号
        conn = _connect()
        row = conn.execute("SELECT value FROM meta WHERE key = 'embed_version'").fetchone()
        conn.close()
        assert int(row["value"]) != 1

    asyncio.run(run())


def test_hybrid_lexical_boost_ranks_exact_term_chunk_first(kb_root):
    """精确词命中（短中文查询）应排到最前。"""

    async def run():
        await ingest_document(
            "hybrid.md",
            "# 政策A\n\n退运须在 7 日内申报，退运费用由卖家承担。\n\n# 政策B\n\n一般贸易报关流程，清关费按货值 0.5% 收取。",
        )
        hit = await search("退运 申报 卖家")
        assert hit["hits"]
        assert "退运须在 7 日内申报" in hit["hits"][0]["text"]

    asyncio.run(run())
