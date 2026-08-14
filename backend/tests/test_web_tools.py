"""web_search inject + web_fetch URL safety."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from web_tools import extract_html_text, merge_web_search, safe_http_url, should_inject_web_search  # noqa: E402


def test_extract_html_text_drops_script():
    html = "<html><script>evil()</script><p>Hello <b>ASIN</b></p></html>"
    text = extract_html_text(html)
    assert "Hello" in text
    assert "ASIN" in text
    assert "evil" not in text


def test_safe_http_url_rejects_localhost_and_file():
    assert safe_http_url("https://www.amazon.com/dp/B0")
    assert safe_http_url("http://127.0.0.1/secret") is None
    assert safe_http_url("file:///etc/passwd") is None
    assert safe_http_url("not a url") is None


def test_merge_web_search_appends_once():
    tools = [{"name": "inspect_workbook"}]
    once = merge_web_search(tools)
    twice = merge_web_search(once)
    names = [t.get("name") for t in twice]
    assert names.count("web_search") == 1
    assert twice[-1]["type"] == "web_search_20250305"


def test_web_search_only_for_deepseek():
    assert should_inject_web_search("https://api.deepseek.com/anthropic") is True
    assert should_inject_web_search("https://open.bigmodel.cn/api/anthropic") is False
