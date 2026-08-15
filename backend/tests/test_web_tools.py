"""web_search inject + web_fetch URL safety."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from web_tools import extract_html_text, extract_html_tables, looks_like_app_shell, empty_fetch_error, merge_web_search, merge_grids, pick_largest_grid, safe_http_url, should_inject_web_search, sheet_name_from_url, slice_grid, summarize_grids, col_to_index, index_to_col, cells_to_grid  # noqa: E402


def test_extract_html_text_drops_script():
    html = "<html><script>evil()</script><p>Hello <b>ASIN</b></p></html>"
    text = extract_html_text(html)
    assert "Hello" in text
    assert "ASIN" in text
    assert "evil" not in text


def test_extract_html_tables():
    html = "<html><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></html>"
    tables = extract_html_tables(html)
    assert tables == [[["A", "B"], ["1", "2"]]]
    assert "取数_" in sheet_name_from_url("https://erp.example.com/report")


def test_safe_http_url_rejects_localhost_and_file():
    assert safe_http_url("https://1.1.1.1/", resolve=False)
    assert safe_http_url("https://www.amazon.com/dp/B0", resolve=False)
    assert safe_http_url("http://127.0.0.1/secret") is None
    assert safe_http_url("http://10.0.0.1/admin") is None
    assert safe_http_url("http://192.168.1.1/") is None
    assert safe_http_url("http://172.16.0.9/") is None
    assert safe_http_url("http://169.254.169.254/latest/meta-data/") is None
    assert safe_http_url("http://2130706433/") is None
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


def test_spa_shell_has_no_table():
    html = "<html><body><div id='app'></div><script src='a.js'></script><script src='b.js'></script></body></html>"
    assert looks_like_app_shell(html, extract_html_text(html), extract_html_tables(html)) is True
    table_html = "<html><table><tr><td>1</td></tr></table><script src='a.js'></script></html>"
    tables = extract_html_tables(table_html)
    assert looks_like_app_shell(table_html, extract_html_text(table_html), tables) is False


def test_empty_fetch_error_is_chinese_and_mentions_browser_login():
    msg = empty_fetch_error(username="139", password="", as_rows=True)
    assert "未填密码" in msg
    assert "浏览器" in msg
    js = empty_fetch_error(username="", password="", as_rows=True)
    assert "登录" in js
    assert "could not extract" not in js


def test_playwright_hint_is_chinese():
    from web_browser import PLAYWRIGHT_HINT

    assert "playwright install chromium" in PLAYWRIGHT_HINT
    assert "密码" in PLAYWRIGHT_HINT
    assert "could not extract" not in PLAYWRIGHT_HINT


def test_pick_largest_grid():
    small = [["a", "b"], ["1", "2"]]
    big = [["h1", "h2", "h3"], ["1", "2", "3"], ["4", "5", "6"]]
    assert pick_largest_grid([small, big]) == big
    assert pick_largest_grid([]) == []


def test_col_letters_and_slice_grid():
    assert col_to_index("A") == 1
    assert col_to_index("C") == 3
    assert col_to_index("2") == 2
    assert index_to_col(1) == "A"
    assert index_to_col(3) == "C"
    grid = [["h1", "h2", "h3"], ["1", "2", "3"], ["4", "5", "6"]]
    assert slice_grid(grid, "2", "3", "B", "C") == [["2", "3"], ["5", "6"]]
    assert slice_grid(grid, 1, 1, "A", "A") == [["h1"]]
    assert slice_grid([], 1, 2) == []


def test_summarize_grids_skips_empty():
    items = summarize_grids([[["店铺", "金额"], ["A", "1"]], []])
    assert items[0]["rows"] == 2
    assert items[0]["cols"] == 2
    assert items[0]["colLast"] == "B"
    assert "店铺" in items[0]["preview"]


def test_cells_to_grid_clusters_rows_and_cols():
    cells = [
        {"x": 0, "y": 0, "w": 40, "h": 20, "t": "A"},
        {"x": 50, "y": 0, "w": 40, "h": 20, "t": "B"},
        {"x": 0, "y": 24, "w": 40, "h": 20, "t": "1"},
        {"x": 50, "y": 24, "w": 40, "h": 20, "t": "2"},
    ]
    assert cells_to_grid(cells) == [["A", "B"], ["1", "2"]]


def test_cells_to_grid_drops_parent_wrapper():
    cells = [
        {"x": 0, "y": 0, "w": 200, "h": 80, "t": "A B 1 2"},
        {"x": 0, "y": 0, "w": 40, "h": 20, "t": "A"},
        {"x": 50, "y": 0, "w": 40, "h": 20, "t": "B"},
        {"x": 0, "y": 24, "w": 40, "h": 20, "t": "1"},
        {"x": 50, "y": 24, "w": 40, "h": 20, "t": "2"},
    ]
    assert cells_to_grid(cells) == [["A", "B"], ["1", "2"]]


def test_merge_grids_same_header():
    a = [["店铺", "金额"], ["A", "1"]]
    b = [["店铺", "金额"], ["B", "2"]]
    assert merge_grids([a, b]) == [["店铺", "金额"], ["A", "1"], ["B", "2"]]


def test_merge_grids_different_width_stacks():
    a = [["A"], ["1"]]
    b = [["X", "Y"], ["2", "3"]]
    out = merge_grids([a, b])
    assert out[0] == ["A"]
    assert out[1] == ["1"]
    assert out[2] == []
    assert out[3] == ["X", "Y"]
