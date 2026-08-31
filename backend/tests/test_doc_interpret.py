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
    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
        assert "臆造" in system_prompt
        assert inject_web_search is False
        assert max_tokens == 16384
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
    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
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
    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
        assert "碎片" in system_prompt
        assert inject_web_search is False
        assert max_tokens == 16384
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
    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
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
    assert "必须保留前导零" in doc_interpret.SYSTEM_PROMPT
    assert "编号/标识符类值" in doc_interpret.SYSTEM_PROMPT


def test_scalar_keeps_large_integers_as_text():
    assert doc_interpret._scalar(661532633869) == "661532633869"
    assert doc_interpret._scalar(661532633869.0) == "661532633869"
    assert doc_interpret._scalar(65047079890) == "65047079890"
    assert doc_interpret._scalar(2948319) == "2948319"
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

def test_interpret_document_thinking_only_reports_content_types():
    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
        return {
            "content": [{"type": "thinking", "thinking": "想很久..."}],
            "stop_reason": "max_tokens",
        }

    with pytest.raises(ValueError, match="thinking"):
        asyncio.run(doc_interpret.interpret_document("x", model_call=fake_call))

def test_parse_interpret_json_tolerates_preamble_and_trailing_text():
    raw = (
        "好的，以下是整理结果：\n"
        '{"kvs":[{"label":"发票号码","value":"123"}],"items":[],"totals":[],"notes":[]}\n'
        "希望有帮助。"
    )
    parsed = doc_interpret.parse_interpret_json(raw)
    assert parsed["kvs"] == [{"label": "发票号码", "value": "123"}]


def test_parse_recipe_json_tolerates_preamble():
    raw = (
        "字段如下：\n"
        '{"fields":[{"name":"金额","type":"number","source":"金额","group":"detail"}],"notes":[]}'
    )
    parsed = doc_interpret.parse_recipe_json(raw)
    assert parsed["fields"][0]["name"] == "金额"

def test_parse_interpret_json_tolerates_fullwidth_braces():
    raw = '｛"kvs"：［｛"label"："发票号码"，"value"："123"｝］，"items"：［］，"totals"：［］，"notes"：［］｝'
    parsed = doc_interpret.parse_interpret_json(raw)
    assert parsed["kvs"] == [{"label": "发票号码", "value": "123"}]


def test_parse_interpret_json_error_includes_snippet():
    with pytest.raises(ValueError, match="原文片段"):
        doc_interpret.parse_interpret_json("完全没有 JSON 内容的一段话")

def test_interpret_document_stream_yields_deltas_then_result():
    async def fake_stream(messages, system_prompt=None, model=None, max_tokens=4096, tools=None, inject_web_search=True):
        yield '{"kvs":[{"label":"发票号码","value":"123"}],"items":[],"totals":[],"notes":[]}'

    events = []

    async def collect():
        async for event in doc_interpret.interpret_document_stream("x", model_call=fake_stream):
            events.append(event)

    asyncio.run(collect())
    assert events[-1][0] == "result"
    assert events[-1][1]["kvs"] == [{"label": "发票号码", "value": "123"}]


def test_interpret_document_stream_surfaces_error():
    async def fake_stream(messages, system_prompt=None, model=None, max_tokens=4096, tools=None, inject_web_search=True):
        yield "Error: No API key configured."

    events = []

    async def collect():
        async for event in doc_interpret.interpret_document_stream("x", model_call=fake_stream):
            events.append(event)

    asyncio.run(collect())
    assert events[0][0] == "error"
    assert "No API key" in events[0][1]

def test_interpret_document_retries_on_thinking_truncation():
    calls = []

    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
        calls.append(messages)
        if len(calls) == 1:
            return {"content": [{"type": "thinking", "thinking": "想很久..."}], "stop_reason": "max_tokens"}
        return {"content": [{"type": "text", "text": '{"kvs":[{"label":"发票号码","value":"123"}],"items":[],"totals":[],"notes":[]}'}]}

    result = asyncio.run(doc_interpret.interpret_document("x", model_call=fake_call))
    assert result["kvs"] == [{"label": "发票号码", "value": "123"}]
    assert len(calls) == 2
    assert "禁止任何思考" in calls[1][0]["content"]


def test_interpret_document_stream_retries_when_empty():
    attempts = []

    async def fake_stream(messages, system_prompt=None, model=None, max_tokens=4096, tools=None, inject_web_search=True):
        attempts.append(messages)
        if len(attempts) == 1:
            return
        yield '{"kvs":[{"label":"发票号码","value":"123"}],"items":[],"totals":[],"notes":[]}'

    events = []

    async def collect():
        async for event in doc_interpret.interpret_document_stream("x", model_call=fake_stream):
            events.append(event)

    asyncio.run(collect())
    assert events[-1][0] == "result"
    assert events[-1][1]["kvs"] == [{"label": "发票号码", "value": "123"}]
    assert len(attempts) == 2
    assert "禁止任何思考" in attempts[1][0]["content"]


def test_scalar_never_roundtrips_large_int_through_float():
    # 20-digit identifier must keep every digit (float would lose precision)
    assert doc_interpret._scalar(54712936090321790480) == "54712936090321790480"
    assert doc_interpret._scalar(661533632869) == "661533632869"


def test_repair_digit_values_recovers_leading_zeros_from_ocr():
    ocr = (
        "发票代码：031001700111\n"
        "发票号码：02948319\n"
        "机器编号：661533632869\n"
        "校验码: 54712936090321790480"
    )
    result = {
        "kvs": [
            {"label": "发票代码", "value": "31001700111"},
            {"label": "发票号码", "value": "2948319"},
            {"label": "机器编号", "value": "661533632869"},
            {"label": "校验码", "value": "54712936090321790480"},
        ],
        "items": [],
        "totals": [],
        "notes": [],
    }
    fixed = doc_interpret._repair_digit_values(result, ocr)
    values = {item["label"]: item["value"] for item in fixed["kvs"]}
    assert values["发票代码"] == "031001700111"
    assert values["发票号码"] == "02948319"
    assert values["机器编号"] == "661533632869"
    assert values["校验码"] == "54712936090321790480"


def test_repair_digit_values_leaves_amounts_untouched():
    ocr = "价税合计：108.10\n数量：1"
    result = {
        "kvs": [{"label": "价税合计", "value": 108.1}],
        "items": [],
        "totals": [],
        "notes": [],
    }
    fixed = doc_interpret._repair_digit_values(result, ocr)
    assert fixed["kvs"][0]["value"] == 108.1


def test_recipe_prompt_prefers_annotation_labels():
    """The recipe prompt must tell the model to use annotation labels as field
    names in any language (form and annotations may differ in language)."""
    assert "标注标签" in doc_interpret.RECIPE_SYSTEM_PROMPT
    assert "语言不同" in doc_interpret.RECIPE_SYSTEM_PROMPT
    assert "source" in doc_interpret.RECIPE_SYSTEM_PROMPT


def test_parse_recipe_json_keeps_any_language_names_and_sources():
    """Field names/sources in any language (Chinese annotation on an English
    form; German annotation on a French form) must pass through untouched."""
    raw = (
        '{"fields":['
        '{"name":"\u53d1\u7968\u53f7","type":"text","source":"Invoice #","group":"header"},'
        '{"name":"\u53d1\u7968\u65e5\u671f","type":"date","source":"Invoice Date","group":"header"},'
        '{"name":"Rechnungsnr","type":"text","source":"Num\u00e9ro de facture","group":"header"},'
        '{"name":"Menge","type":"number","source":"Quantit\u00e9","group":"detail"}'
        '],"notes":[]}'
    )
    parsed = doc_interpret.parse_recipe_json(raw)
    names = [(f["name"], f["source"], f["group"]) for f in parsed["fields"]]
    assert names == [
        ("\u53d1\u7968\u53f7", "Invoice #", "header"),
        ("\u53d1\u7968\u65e5\u671f", "Invoice Date", "header"),
        ("Rechnungsnr", "Num\u00e9ro de facture", "header"),
        ("Menge", "Quantit\u00e9", "detail"),
    ]


def test_bounded_ocr_text_truncates_head_tail():
    long = "x" * 30000
    b = doc_interpret._bounded_ocr_text(long)
    assert len(b) < 13000
    assert "中间省略" in b
    assert b.startswith("x" * 100)
    assert b.endswith("x" * 100)


def test_interpret_and_recipe_prompts_have_example():
    assert "示例" in doc_interpret.SYSTEM_PROMPT
    assert "示例" in doc_interpret.RECIPE_SYSTEM_PROMPT


def test_interpret_document_retries_on_bad_json():
    calls = []

    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
        calls.append(messages)
        if len(calls) == 1:
            return {"content": [{"type": "text", "text": "not json at all"}]}
        return {
            "content": [
                {
                    "type": "text",
                    "text": '{"kvs": [{"label": "\u53d1\u7968\u53f7\u7801", "value": "12345678"}], "items": [], "totals": [], "notes": []}',
                }
            ]
        }

    result = asyncio.run(
        doc_interpret.interpret_document("\u53d1\u7968\u53f7\u7801: 12345678", model_call=fake_call)
    )
    assert result["kvs"] == [{"label": "\u53d1\u7968\u53f7\u7801", "value": "12345678"}]
    assert len(calls) == 2
    assert "合法" in calls[1][0]["content"]  # strict-JSON hint present


def test_propose_recipe_retries_on_bad_json():
    calls = []

    async def fake_call(messages, system_prompt=None, model=None, inject_web_search=True, max_tokens=4096):
        calls.append(messages)
        if len(calls) == 1:
            return {"content": [{"type": "text", "text": "oops"}]}
        return {
            "content": [
                {
                    "type": "text",
                    "text": '{"fields": [{"name": "\u53d1\u7968\u53f7\u7801", "type": "text", "source": "\u53d1\u7968\u53f7\u7801", "group": "header"}], "notes": []}',
                }
            ]
        }

    result = asyncio.run(
        doc_interpret.propose_recipe_ai("\u53d1\u7968\u53f7\u7801: 12345678", model_call=fake_call)
    )
    assert result["fields"][0]["name"] == "\u53d1\u7968\u53f7\u7801"
    assert len(calls) == 2
