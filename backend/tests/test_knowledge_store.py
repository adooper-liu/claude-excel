"""Local knowledge RAG store."""

import asyncio

import pytest

from knowledge_store import (
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
