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

def test_recipe_prompt_mentions_fragments_and_groups():
    assert "碎片" in doc_interpret.RECIPE_SYSTEM_PROMPT
    assert "header" in doc_interpret.RECIPE_SYSTEM_PROMPT
    assert "detail" in doc_interpret.RECIPE_SYSTEM_PROMPT


def test_parse_recipe_json_normalizes_filters_and_dedupes():
    raw = (
        '{"fields":['
        '{"name":"购买方","type":"text","source":"购","group":"header"},'
        '{"name":"名","type":"text","source":"名","group":"header"},'
        '{"name":"BR","type":"text","source":"BR","group":"detail"},'
        '{"name":"金额","type":"number","source":"金额","group":"detail"},'
        '{"name":"金额","type":"text","source":"金额","group":"detail"},'
        '{"name":"名称: 个人","type":"text","source":"x","group":"detail"},'
        '{"name":"1234//<>*","type":"text","source":"y","group":"detail"},'
        '{"type":"number","source":"无名字"},'
        '{"name":"","type":"text","source":"空名字"}'
        '],"notes":["噪声较多"]}'
    )
    parsed = doc_interpret.parse_recipe_json(raw)
    names = [f["name"] for f in parsed["fields"]]
    assert names.count("金额") == 1
    assert "名称: 个人" not in names
    assert "1234//<>*" not in names
    assert "购买方" in names
    assert "BR" in names
    assert parsed["notes"] == ["噪声较多"]


def test_parse_recipe_json_defaults_type_and_group():
    parsed = doc_interpret.parse_recipe_json(
        '{"fields":[{"name":"备注","type":"bogus","group":"weird"}]}'
    )
    field = parsed["fields"][0]
    assert field["type"] == "text"
    assert field["group"] == "detail"


def test_propose_recipe_ai_uses_injected_model_call():
    async def fake_call(messages, system_prompt=None, model=None):
        assert "碎片" in system_prompt
        return {
            "content": [
                {
                    "type": "text",
                    "text": '{"fields":[{"name":"购买方名称","type":"text","source":"购买方名称","group":"header"},{"name":"金额","type":"number","source":"金额","group":"detail"}],"notes":[]}',
                }
            ]
        }

    result = asyncio.run(
        doc_interpret.propose_recipe_ai(
            "购买方名称: 个人", base_name="发票", model_call=fake_call
        )
    )
    assert result["name"] == "发票"
    assert result["fields"][0]["name"] == "购买方名称"
    assert result["fields"][1]["type"] == "number"


def test_propose_recipe_ai_surfaces_model_error():
    async def fake_call(messages, system_prompt=None, model=None):
        return {"content": [{"type": "text", "text": "Error: No API key configured."}]}

    with pytest.raises(ValueError, match="No API key"):
        asyncio.run(doc_interpret.propose_recipe_ai("x", model_call=fake_call))

def test_recipe_prompt_enforces_types_and_occurrence_sources():
    assert "编号类纯数字长串" in doc_interpret.RECIPE_SYSTEM_PROMPT
    assert "键名#1" in doc_interpret.RECIPE_SYSTEM_PROMPT
    assert "价税合计只保留一条" in doc_interpret.RECIPE_SYSTEM_PROMPT


def test_parse_recipe_json_dedupes_sources_and_keeps_occurrence():
    raw = (
        '{"fields":['
        '{"name":"价税合计（小写）","type":"amount","source":"价税合计","group":"header"},'
        '{"name":"价税合计（大写）","type":"text","source":"价税合计","group":"header"},'
        '{"name":"购买方名称","type":"text","source":"名称#1","group":"header"},'
        '{"name":"销售方名称","type":"text","source":"名称#2","group":"header"}'
        '],"notes":[]}'
    )
    parsed = doc_interpret.parse_recipe_json(raw)
    names = [f["name"] for f in parsed["fields"]]
    assert names == ["价税合计（小写）", "购买方名称", "销售方名称"]

def test_interpret_prompt_keeps_ids_as_text():
    assert "编号类长数字串" in doc_interpret.SYSTEM_PROMPT
    assert "科学计数法" in doc_interpret.SYSTEM_PROMPT


def test_scalar_keeps_large_integers_as_text():
    assert doc_interpret._scalar(661532633869) == "661532633869"
    assert doc_interpret._scalar(65047079890) == "65047079890"
    assert doc_interpret._scalar(108.1) == 108.1
    assert doc_interpret._scalar(1) == 1
    assert doc_interpret._scalar("031001700111") == "031001700111"


def test_parse_interpret_json_keeps_large_ids_as_text():
    raw = (
        '{"kvs":[{"label":"机器编号","value":661532633869},'
        '{"label":"价税合计","value":108.1}],'
        '"items":[],"totals":[],"notes":[]}'
    )
    parsed = doc_interpret.parse_interpret_json(raw)
    assert parsed["kvs"] == [
        {"label": "机器编号", "value": "661532633869"},
        {"label": "价税合计", "value": 108.1},
    ]

def test_extract_text_accepts_parts_without_type():
    payload = {"content": [{"text": "第一段"}, {"text": "第二段"}]}
    assert doc_interpret._extract_text(payload) == "第一段\n第二段"
