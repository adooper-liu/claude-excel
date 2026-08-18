"""Table structure notes store tests."""

import pytest

from table_structure_store import get_notes, list_notes, save_notes


@pytest.fixture
def notes_root(tmp_path, monkeypatch):
    f = tmp_path / "table-structures.json"
    monkeypatch.setattr("table_structure_store.NOTES_FILE", f)
    return f


def test_save_and_get(notes_root):
    entry = save_notes("key1", "Sheet1", {
        "schema": {"cols": 135, "rows": 151, "headers": {"BG": "计价重", "BH": "价格"}},
        "inferences": [{"claim": "1050 = 7 zones x 150", "confidence": "high", "evidence": "rows=151 (header+150)"}],
        "advisories": [{"note": "附加费块按自己的 ZONE 列取值", "source": "user_correction"}],
    })
    assert entry["schema"]["cols"] == 135
    assert entry["inferences"][0]["claim"] == "1050 = 7 zones x 150"
    assert entry["advisories"][0]["source"] == "user_correction"
    got = get_notes("key1", "Sheet1")
    assert got["schema"]["headers"]["BG"] == "计价重"


def test_rejects_inference_without_evidence(notes_root):
    """无证据的推断不许存——防止把上次会话的猜测固化成真相。"""
    entry = save_notes("k", "S", {
        "schema": {"cols": 2, "headers": {"A": "x"}},
        "inferences": [{"claim": "无证据的推断", "confidence": "high"}],
    })
    assert entry["inferences"] == []


def test_rejects_bad_confidence(notes_root):
    entry = save_notes("k", "S", {
        "schema": {"cols": 2, "headers": {"A": "x"}},
        "inferences": [{"claim": "c", "confidence": "sure", "evidence": "e"}],
    })
    assert entry["inferences"] == []


def test_rejects_missing_schema(notes_root):
    with pytest.raises(ValueError):
        save_notes("k", "S", {"inferences": []})


def test_drops_invalid_header_keys(notes_root):
    """headers 键必须是列字母；列索引等脏键丢弃，不污染真相源。"""
    entry = save_notes("k", "S", {
        "schema": {"cols": 2, "headers": {"A": "列A", "184": "脏键"}},
    })
    assert "A" in entry["schema"]["headers"]
    assert "184" not in entry["schema"]["headers"]


def test_previous_keeps_old_for_diff(notes_root):
    save_notes("k", "S", {"schema": {"cols": 10, "headers": {"A": "旧"}}})
    second = save_notes("k", "S", {"schema": {"cols": 12, "headers": {"A": "新"}}})
    assert second["previous"]["schema"]["cols"] == 10


def test_keyed_by_file_and_sheet(notes_root):
    save_notes("k1", "S", {"schema": {"cols": 1, "headers": {"A": "x"}}})
    save_notes("k2", "S", {"schema": {"cols": 2, "headers": {"A": "x"}}})
    save_notes("k1", "T", {"schema": {"cols": 3, "headers": {"A": "x"}}})
    assert get_notes("k1", "S")["schema"]["cols"] == 1
    assert get_notes("k2", "S")["schema"]["cols"] == 2
    assert get_notes("k1", "T")["schema"]["cols"] == 3


def test_list_notes_returns_markers(notes_root):
    """固定标记清单：哪些 sheet 已有笔记（用于跳过重复 inspect）。"""
    save_notes("k1", "S", {"schema": {"cols": 135, "rows": 1051, "headers": {"BG": "x"}}})
    save_notes("k1", "T", {"schema": {"cols": 3, "rows": 5, "headers": {"A": "x"}}})
    markers = list_notes("k1")
    assert {"sheet": "S", "cols": 135, "rows": 1051, "has_note": True} in markers
    assert {"sheet": "T", "cols": 3, "rows": 5, "has_note": True} in markers
    assert list_notes("nokey") == []
