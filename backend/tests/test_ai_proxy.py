"""Behavioral contract for the AI proxy error mapping."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import ai_proxy  # noqa: E402


def test_rate_limit_error_is_friendly_and_keeps_reset_hint():
    body = (
        '{"type":"error","error":{"type":"rate_limit_error","code":"1310",'
        '"message":"您已达到每周/每月使用上限，您的限额将在 2026-09-04 04:04:07 重置。"}}'
    )
    text = ai_proxy._api_error_text(429, body)
    assert "限流" in text
    assert "2026-09-04" in text


def test_generic_error_keeps_body():
    text = ai_proxy._api_error_text(500, "boom")
    assert "500" in text
    assert "boom" in text


def test_error_extracts_json_message():
    text = ai_proxy._api_error_text(400, '{"error":{"message":"bad request"}}')
    assert "bad request" in text