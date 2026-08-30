"""Behavioral contract for the RapidStruct layout path (Task 10).

The rapid path (``extract_layout_from_image_rapid``) must build the same
``LayoutDocument`` from layout regions + table HTML, and must silently fall
back to the tesseract word-box path when the optional packages are missing
or raise.  Rapid classes are mocked — no real models are loaded here.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from PIL import Image  # noqa: E402

import layout_extract  # noqa: E402
from layout_doc import LayoutDocument  # noqa: E402


def _quad(x1, y1, x2, y2):
    """A 4-point quad box (RapidOCR output shape)."""
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


class _FakeLayoutOutput:
    # text region + table region
    boxes = [[10, 10, 400, 40], [10, 60, 500, 160]]
    class_names = ["text", "table"]
    scores = [0.95, 0.95]


class _FakeLayoutEngine:
    def __call__(self, image):
        return _FakeLayoutOutput()


class _FakeTableOutput:
    pred_htmls = [
        "<html><body><table>"
        "<tr><td>\u54c1\u540d</td><td>\u91d1\u989d</td><td>\u7a0e\u7387</td></tr>"
        "<tr><td>A\u4ea7\u54c1</td><td>1,234.56</td><td>13%</td></tr>"
        "</table></body></html>"
    ]


class _FakeTableEngine:
    def __init__(self, pred_htmls=None):
        self.pred_htmls = pred_htmls if pred_htmls is not None else _FakeTableOutput.pred_htmls

    def __call__(self, image):
        output = _FakeTableOutput()
        output.pred_htmls = list(self.pred_htmls)
        return output


class _FakeOCROutput:
    boxes = [
        _quad(15, 15, 75, 27),     # \u53d1\u7968\u53f7\u7801:
        _quad(150, 15, 220, 27),   # 12345678
        _quad(20, 70, 40, 82),     # \u54c1\u540d (table cell)
        _quad(120, 70, 140, 82),   # \u91d1\u989d (table cell)
        _quad(240, 70, 260, 82),   # \u7a0e\u7387 (table cell)
        _quad(20, 100, 50, 112),   # A\u4ea7\u54c1 (table cell)
        _quad(120, 100, 160, 112), # 1,234.56 (table cell)
        _quad(240, 100, 264, 112), # 13% (table cell)
    ]
    txts = [
        "\u53d1\u7968\u53f7\u7801:",
        "12345678",
        "\u54c1\u540d",
        "\u91d1\u989d",
        "\u7a0e\u7387",
        "A\u4ea7\u54c1",
        "1,234.56",
        "13%",
    ]
    scores = [0.99] * 8


class _FakeOCREngine:
    def __call__(self, image):
        return _FakeOCROutput()


def _image():
    return Image.new("RGB", (600, 200), "white")


def _patch_engines(monkeypatch, table=None, ocr=None, layout=None):
    monkeypatch.setattr(
        layout_extract,
        "_rapid_engines",
        lambda: (layout or _FakeLayoutEngine(), table or _FakeTableEngine(), ocr or _FakeOCREngine()),
    )


def test_rapid_builds_table_and_kvs(monkeypatch):
    _patch_engines(monkeypatch)
    layout = layout_extract.extract_layout_from_image_rapid(_image())
    assert layout.kv("\u53d1\u7968\u53f7\u7801") == "12345678"
    # table cell text must not leak into kvs
    assert layout.kv("\u54c1\u540d") is None
    assert len(layout.tables) == 1
    table = layout.tables[0]
    assert table.headers == ["\u54c1\u540d", "\u91d1\u989d", "\u7a0e\u7387"]
    assert table.rows == [["A\u4ea7\u54c1", "1,234.56", "13%"]]
    assert "12345678" in layout.raw_text


def test_rapid_skips_markdown_separator_row():
    html = (
        "<table>"
        "<tr><td>\u54c1\u540d</td><td>\u91d1\u989d</td></tr>"
        "<tr><td>---</td><td>---</td></tr>"
        "<tr><td>A</td><td>1</td></tr>"
        "</table>"
    )
    table = layout_extract._table_from_html(html)
    assert table.headers == ["\u54c1\u540d", "\u91d1\u989d"]
    assert table.rows == [["A", "1"]]


def test_rapid_table_colspan_expands():
    html = (
        "<table>"
        "<tr><td colspan=\"2\">\u5408\u8ba1</td><td>108.10</td></tr>"
        "</table>"
    )
    table = layout_extract._table_from_html(html)
    assert table.rows == [["\u5408\u8ba1", "\u5408\u8ba1", "108.10"]]


def test_rapid_malformed_html_never_raises():
    table = layout_extract._table_from_html("<table><tr><td")
    assert table.headers == []
    assert table.rows == []


def test_rapid_empty_table_html_drops_table(monkeypatch):
    _patch_engines(monkeypatch, table=_FakeTableEngine(pred_htmls=[]))
    layout = layout_extract.extract_layout_from_image_rapid(_image())
    assert layout.tables == []
    assert layout.kv("\u53d1\u7968\u53f7\u7801") == "12345678"


def test_rapid_available_reflects_packages(monkeypatch):
    monkeypatch.setattr(layout_extract, "RAPID_PACKAGES", ("os",))
    assert layout_extract._rapid_available() is True
    monkeypatch.setattr(layout_extract, "RAPID_PACKAGES", ("definitely_not_a_pkg_xyz",))
    assert layout_extract._rapid_available() is False


def test_rapid_unavailable_falls_back_to_tesseract(monkeypatch):
    calls = []

    def fake_tesseract(image):
        calls.append(image)
        return LayoutDocument(kvs=[])

    monkeypatch.setattr(layout_extract, "_rapid_available", lambda: False)
    monkeypatch.setattr(layout_extract, "_extract_layout_tesseract", fake_tesseract)
    image = _image()
    layout = layout_extract.extract_layout_from_image(image)
    assert layout == LayoutDocument(kvs=[])
    assert calls == [image]


def test_rapid_raise_falls_back_not_crash(monkeypatch):
    calls = []

    def fake_tesseract(image):
        calls.append(image)
        return LayoutDocument(kvs=[])

    def broken_engines():
        raise RuntimeError("model download failed")

    monkeypatch.setattr(layout_extract, "_rapid_engines", broken_engines)
    monkeypatch.setattr(layout_extract, "_extract_layout_tesseract", fake_tesseract)
    image = _image()
    layout = layout_extract.extract_layout_from_image_rapid(image)
    assert layout == LayoutDocument(kvs=[])
    assert calls == [image]


def test_rapid_table_region_crash_falls_back(monkeypatch):
    class _BrokenTableEngine:
        def __call__(self, image):
            raise RuntimeError("table engine boom")

    _patch_engines(monkeypatch, table=_BrokenTableEngine())
    layout = layout_extract.extract_layout_from_image_rapid(_image())
    # KV from text region survives; table region crash must not kill the run
    assert layout.kv("\u53d1\u7968\u53f7\u7801") == "12345678"
    assert layout.tables == []
