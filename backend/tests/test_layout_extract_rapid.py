"""Behavioral contract for the RapidStruct layout path (Task 10).

The rapid path (``extract_layout_from_image_rapid``) must build the same
``LayoutDocument`` from layout regions + table HTML, and must silently fall
back to the tesseract word-box path when the optional packages are missing
or raise.  Rapid classes are mocked — no real models are loaded here.
"""

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import types  # noqa: E402
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
    # line-level boxes (RapidOCR semantic): one text line per box
    boxes = [
        _quad(15, 12, 240, 26),    # \u53d1\u7968\u53f7\u7801: 12345678
        _quad(15, 30, 240, 44),    # \u5f00\u7968\u65e5\u671f: 2026-08-30
        _quad(20, 70, 50, 82),     # \u54c1\u540d (table header)
        _quad(120, 70, 150, 82),   # \u91d1\u989d
        _quad(240, 70, 270, 82),   # \u7a0e\u7387
        _quad(20, 100, 60, 112),   # A\u4ea7\u54c1 (data)
        _quad(120, 100, 170, 112), # 1,234.56
        _quad(240, 100, 274, 112), # 13%
        _quad(20, 130, 60, 142),   # B\u4ea7\u54c1 (data)
        _quad(120, 130, 160, 142), # 56.00
        _quad(240, 130, 274, 142), # 13%
    ]
    txts = [
        "\u53d1\u7968\u53f7\u7801: 12345678",
        "\u5f00\u7968\u65e5\u671f: 2026-08-30",
        "\u54c1\u540d",
        "\u91d1\u989d",
        "\u7a0e\u7387",
        "A\u4ea7\u54c1",
        "1,234.56",
        "13%",
        "B\u4ea7\u54c1",
        "56.00",
        "13%",
    ]
    scores = [0.99] * 11


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
    assert layout.engine == "rapid"
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


def test_rapid_empty_table_html_falls_back_to_positional(monkeypatch):
    _patch_engines(monkeypatch, table=_FakeTableEngine(pred_htmls=[]))
    layout = layout_extract.extract_layout_from_image_rapid(_image())
    # RapidTable gave nothing -> positional rows from OCR boxes still build the table
    assert len(layout.tables) == 1
    assert layout.tables[0].headers == ["\u54c1\u540d", "\u91d1\u989d", "\u7a0e\u7387"]
    assert layout.tables[0].rows == [
        ["A\u4ea7\u54c1", "1,234.56", "13%"],
        ["B\u4ea7\u54c1", "56.00", "13%"],
    ]
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


def test_rapid_table_region_crash_falls_back_to_positional(monkeypatch):
    class _BrokenTableEngine:
        def __call__(self, image):
            raise RuntimeError("table engine boom")

    _patch_engines(monkeypatch, table=_BrokenTableEngine())
    layout = layout_extract.extract_layout_from_image_rapid(_image())
    # KV survives and the table is rebuilt from positional OCR boxes
    assert layout.kv("\u53d1\u7968\u53f7\u7801") == "12345678"
    assert len(layout.tables) == 1
    assert layout.tables[0].headers == ["\u54c1\u540d", "\u91d1\u989d", "\u7a0e\u7387"]
    assert len(layout.tables[0].rows) == 2


# ---------------------------------------------------------------------------
# Real-machine smoke tests (Task 10). The tests above mock ``_rapid_engines``,
# so they cannot catch a wrong import name or result attribute name in the
# real packages. These run only when the optional RapidStruct packages are
# installed (CI auto-skips via ``importorskip``) and lock the REAL API surface
# the production code depends on. First run instantiates real models and may
# download weights.
# ---------------------------------------------------------------------------


def _exposes(obj, name):
    """True when obj (dict-like or attribute object) exposes ``name``."""
    if isinstance(obj, dict):
        return name in obj
    return hasattr(obj, name)


def _smoke_image():
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (640, 160), "white")
    draw = ImageDraw.Draw(image)
    draw.text((20, 30), "Invoice 12345678", fill="black")
    draw.text((20, 60), "Amount 1,234.56", fill="black")
    return image


def test_rapid_real_engines_api_surface():
    """Real import names and result attribute names must match production."""
    pytest.importorskip("rapid_layout")
    pytest.importorskip("rapid_table")
    pytest.importorskip("rapidocr")

    image = _smoke_image()

    # Real import names must resolve and instantiate (locks _rapid_engines).
    layout_engine, table_engine, ocr_engine = layout_extract._rapid_engines()

    # Real result objects must expose the attribute names _attr() reads.
    layout_result = layout_engine(image)
    assert _exposes(layout_result, "boxes")
    assert _exposes(layout_result, "class_names")

    ocr_result = ocr_engine(image)
    assert _exposes(ocr_result, "boxes")
    assert _exposes(ocr_result, "txts")
    assert _exposes(ocr_result, "scores")

    table_result = table_engine(image)
    assert _exposes(table_result, "pred_htmls")


def test_rapid_real_path_does_not_fall_back(monkeypatch):
    """End-to-end: the rapid path must not silently drop to tesseract.

    Requires models to be downloaded and the synthetic image to be detected by
    RapidLayout; a real document image is the stronger check on a dev machine.
    """
    pytest.importorskip("rapid_layout")
    pytest.importorskip("rapid_table")
    pytest.importorskip("rapidocr")

    image = _smoke_image()

    def boom(_image):
        raise AssertionError("rapid path silently fell back to tesseract")

    monkeypatch.setattr(layout_extract, "_extract_layout_tesseract", boom)
    layout = layout_extract.extract_layout_from_image_rapid(image)
    assert isinstance(layout, LayoutDocument)


def test_rapid_handles_ndarray_ocr_boxes(monkeypatch):
    """Real RapidOCR returns np.ndarray boxes; truthiness must not explode."""
    np = pytest.importorskip("numpy")

    class _NpOCREngine:
        def __call__(self, image):
            output = _FakeOCROutput()
            output.boxes = np.array(_FakeOCROutput.boxes, dtype=float)
            return output

    _patch_engines(monkeypatch, ocr=_NpOCREngine())
    layout = layout_extract.extract_layout_from_image_rapid(_image())
    assert layout.kv("\u53d1\u7968\u53f7\u7801") == "12345678"
    assert layout.tables[0].headers == ["\u54c1\u540d", "\u91d1\u989d", "\u7a0e\u7387"]
    assert layout.tables[0].rows == [["A\u4ea7\u54c1", "1,234.56", "13%"]]


def test_tesseract_path_sets_engine(monkeypatch):
    """The word-box fallback must label the layout as tesseract."""
    import sys
    import types

    fake = types.SimpleNamespace()
    fake.Output = types.SimpleNamespace(DICT="dict")
    fake.image_to_data = lambda image, lang, output_type: {
        "left": [], "top": [], "width": [], "height": [], "conf": [], "text": []
    }
    monkeypatch.setitem(sys.modules, "pytesseract", fake)
    monkeypatch.setattr(layout_extract, "_rapid_available", lambda: False)
    layout = layout_extract.extract_layout_from_image(_image())
    assert layout.engine == "tesseract"


def test_whole_form_table_region_skips_rapidtable_and_rebuilds(monkeypatch):
    """A table region covering most of the page (dense invoice form) must not
    be fed to RapidTable (garbled grid); positional rows rebuild the table."""
    calls = []

    class _WholeFormLayoutOutput:
        boxes = [[0, 0, 600, 200]]  # whole page = table
        class_names = ["table"]
        scores = [0.95]

    class _WholeFormLayoutEngine:
        def __call__(self, image):
            return _WholeFormLayoutOutput()

    class _SpyTableEngine:
        def __call__(self, image):
            calls.append(image)
            return _FakeTableOutput()

    _patch_engines(monkeypatch, layout=_WholeFormLayoutEngine(), table=_SpyTableEngine())
    layout = layout_extract.extract_layout_from_image_rapid(_image())
    assert calls == []  # RapidTable must not run on a whole-page form
    assert len(layout.tables) == 1
    assert layout.tables[0].headers == ["\u54c1\u540d", "\u91d1\u989d", "\u7a0e\u7387"]
    assert layout.tables[0].rows == [
        ["A\u4ea7\u54c1", "1,234.56", "13%"],
        ["B\u4ea7\u54c1", "56.00", "13%"],
    ]
    assert layout.kv("\u53d1\u7968\u53f7\u7801") == "12345678"


def test_rapid_ocr_lines_preserves_reading_order():
    boxes = [_quad(150, 15, 220, 27), _quad(15, 12, 90, 26), _quad(10, 60, 60, 75)]
    txts = ["middle", "first", "third"]
    assert layout_extract._rapid_ocr_lines(boxes, txts) == [
        "first",
        "middle",
        "third",
    ]


def test_positional_rows_split_on_cell_count_divergence():
    """A short noise row must not join the following detail table (regression:
    flush() used to keep the short run and merge it into the next table)."""
    rows = [
        ["a", "b", "c"],
        ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"],
        ["d1", "d2", "d3", "d4", "d5", "d6", "d7"],
    ]
    tables = layout_extract._tables_from_positional_rows(rows)
    assert len(tables) == 1
    assert tables[0].headers == ["h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8"]
    assert len(tables[0].rows) == 1
    # the ragged data row is padded to the header width (aligned, no shift)
    assert tables[0].rows[0] == ["d1", "d2", "d3", "d4", "d5", "d6", "d7", ""]


def test_is_noise_text():
    assert layout_extract._is_noise_text("4920//289<69>176<78-9386*+1")
    assert layout_extract._is_noise_text("7*<-7423*-<*679709/57670<55")
    assert not layout_extract._is_noise_text("购买方")
    assert not layout_extract._is_noise_text("1,234.56")
    assert not layout_extract._is_noise_text("13%")


def test_noise_blocks_clusters_cipher_column():
    """Symbol-heavy boxes form their own noise block; normal text stays out."""
    items = [
        (10, 100, 200, 130, "购买方"),           # left label (clean)
        (10, 140, 250, 170, "名称：个人"),  # left value (clean)
        (1500, 100, 2300, 130, "4920//289<69>176<78-9386*+1"),  # right noise
        (1500, 140, 2300, 170, "7*<-7423*-<*679709/57670<55"),  # right noise
    ]
    blocks = layout_extract._noise_blocks(items)
    assert len(blocks) == 1
    assert len(blocks[0]) == 2  # both cipher strings in one noise block
    noise_texts = {t for _x1, _y1, _x2, _y2, t in blocks[0]}
    assert noise_texts == {"4920//289<69>176<78-9386*+1", "7*<-7423*-<*679709/57670<55"}

def test_noise_block_excluded_from_tables():
    """The cipher-area block must not contribute table rows."""
    boxes = [
        _quad(10, 100, 300, 130),   # 购买方
        _quad(1500, 100, 2300, 130),  # cipher noise
        _quad(1500, 140, 2300, 170),  # cipher noise
        _quad(10, 200, 200, 230),   # 品名 (detail header)
        _quad(300, 200, 450, 230),  # 金额
        _quad(600, 200, 750, 230),  # 税率
        _quad(10, 260, 200, 290),   # A产品
        _quad(300, 260, 450, 290),  # 1,234.56
        _quad(600, 260, 750, 290),  # 13%
    ]
    txts = [
        "购买方",
        "4920//289<69>176<78-9386*+1",
        "7*<-7423*-<*679709/57670<55",
        "品名",
        "金额",
        "税率",
        "A产品",
        "1,234.56",
        "13%",
    ]
    tables = layout_extract._tables_from_rapid_blocks(boxes, txts)
    assert len(tables) == 1
    assert tables[0].headers == ["品名", "金额", "税率"]
    assert tables[0].rows == [["A产品", "1,234.56", "13%"]]


def test_align_row_to_columns_fills_missing_cells():
    """A ragged OCR data row must align to the header columns by x-distance;
    collisions fall back to the next-nearest column (金额 108.10 is not lost)."""
    columns = [408.0, 828.0, 981.0, 1193.0, 1480.0, 1822.0, 2053.0, 2293.0]
    cells = [
        (390.0, "算法导论"),
        (761.0, "无"),
        (1322.0, "1"),
        (1580.0, "108.10"),
        (1954.0, "108.10"),
        (2045.0, "免税"),
        (2437.0, "*x*"),
    ]
    aligned = layout_extract._align_row_to_columns(cells, columns)
    assert aligned == [
        "算法导论", "无", "", "1", "108.10", "108.10", "免税", "*x*",
    ]


def test_light_path_builds_kvs_and_tables(monkeypatch):
    """Template-mode light path: only RapidOCR, still yields kvs + positional table."""
    class _FakeOCREngine2:
        def __call__(self, image):
            return _FakeOCROutput()

    monkeypatch.setattr(layout_extract, "_rapid_ocr_engine", lambda: _FakeOCREngine2())
    layout = layout_extract.extract_layout_from_image_light(_image())
    assert layout.engine == "rapid"
    assert layout.kv("\u53d1\u7968\u53f7\u7801") == "12345678"
    assert len(layout.tables) == 1
    assert layout.tables[0].headers == ["\u54c1\u540d", "\u91d1\u989d", "\u7a0e\u7387"]
    assert layout.tables[0].rows == [
        ["A\u4ea7\u54c1", "1,234.56", "13%"],
        ["B\u4ea7\u54c1", "56.00", "13%"],
    ]
