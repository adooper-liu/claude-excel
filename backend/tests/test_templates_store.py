"""User prompt templates persist to ~/.claude-excel-web/templates.json."""

from pathlib import Path

from templates_store import read_templates, write_templates


def test_roundtrip(tmp_path: Path):
    path = tmp_path / "templates.json"
    write_templates(path, [{"id": "mine", "title": "我的", "prompt": "对账"}])
    got = read_templates(path)
    assert got == [{"id": "mine", "title": "我的", "prompt": "对账"}]


def test_missing_file_is_empty(tmp_path: Path):
    assert read_templates(tmp_path / "nope.json") == []


def test_drops_invalid_entries(tmp_path: Path):
    path = tmp_path / "templates.json"
    path.write_text('{"templates":[{"title":"x"},{"id":"a","title":"t","prompt":"p"}]}', encoding="utf-8")
    got = read_templates(path)
    assert got == [{"id": "a", "title": "t", "prompt": "p"}]
