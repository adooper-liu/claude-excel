"""Behavioral contract for AI document interpretation."""

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import doc_interpret  # noqa: E402


def test_build_messages_embeds_ocr_text_and_rows():
    messages = doc_interpret.build_interpret_messages("发票号: 123", rows=[["a", "b"]])
    assert messages[0]["role"] == "user"
    assert "发票号: 123" in messages[0]["content"]
    assert '"a"' in messages[0]["content"]


def test_system_prompt_forbids_fabrication():
    assert "臆造" in doc_interpret.SYSTEM_PROMPT
    assert "OCR" in doc_interpret.SYSTEM_PROMPT


def test_parse_interpret_json_normalizes_shape():
    raw = (
        '{"kvs":[{"label":"发票号码","value":"123"}],'
        '"items":[{"columns":["品名","金额"],"rows":[["A",108.1]]}],'
        '"totals":[{"label":"价税合计","value":108.1}],'
        '"notes":["大写金额疑似错字"]}'
    )
    parsed = doc_interpret.parse_interpret_json(raw)
    assert parsed["kvs"] == [{"label": "发票号码", "value": "123"}]
    assert parsed["items"] == [{"columns": ["品名", "金额"], "rows": [["A", 108.1]]}]
    assert parsed["totals"] == [{"label": "价税合计", "value": 108.1}]
    assert parsed["notes"] == ["大写金额疑似错字"]


def test_parse_interpret_json_handles_code_fence():
    raw = '```json\n{"kvs": [], "items": [], "totals": [], "notes": []}\n```'
    parsed = doc_interpret.parse_interpret_json(raw)
    assert parsed["kvs"] == []
    assert parsed["notes"] == []


def test_parse_interpret_json_rejects_invalid():
    with pytest.raises(ValueError):
        doc_interpret.parse_interpret_json("not json at all")
    with pytest.raises(ValueError):
        doc_interpret.parse_interpret_json('["array"]')


def test_interpret_document_uses_injected_model_call():
    async def fake_call(messages, system_prompt=None, model=None):
        assert "臆造" in system_prompt
        return {
            "content": [
                {
                    "type": "text",
                    "text": '{"kvs": [{"label": "发票号码", "value": "12345678"}], "items": [], "totals": [], "notes": []}',
                }
            ]
        }

    result = asyncio.run(
        doc_interpret.interpret_document("发票号码: 12345678", model_call=fake_call)
    )
    assert result["kvs"] == [{"label": "发票号码", "value": "12345678"}]


def test_interpret_document_surfaces_model_error():
    async def fake_call(messages, system_prompt=None, model=None):
        return {"content": [{"type": "text", "text": "Error: No API key configured."}]}

    with pytest.raises(ValueError, match="No API key"):
        asyncio.run(doc_interpret.interpret_document("x", model_call=fake_call))