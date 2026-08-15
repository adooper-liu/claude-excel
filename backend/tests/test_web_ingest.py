"""Chrome extension ingest queue."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

import fetch_recipe as fr  # noqa: E402
from web_ingest import ack_ingest, pending_ingest, push_ingest, reset_ingest  # noqa: E402


def setup_function():
    reset_ingest()


def test_push_pending_ack():
    r = push_ingest({"rows": [["h1", "h2"], ["1", "2"]], "url": "https://shop.example.com/list"})
    assert r["ok"] is True
    assert "取数_" in r["sheetName"]
    job = pending_ingest()["job"]
    assert job["rows"][0] == ["h1", "h2"]
    assert "password" not in job
    ack_ingest(job["id"])
    assert pending_ingest()["job"] is None


def test_append_uses_last_sheet():
    first = push_ingest({"rows": [["h"], ["a"]], "sheetName": "取数_demo"})
    assert first["append"] is False
    second = push_ingest({"rows": [["h"], ["b"]], "append": True})
    assert second["append"] is True
    assert second["sheetName"] == "取数_demo"


def test_empty_rows_error():
    r = push_ingest({"rows": []})
    assert "error" in r


def test_blank_cells_error():
    r = push_ingest({"rows": [["", ""], ["", ""]]})
    assert "error" in r
    assert "空" in r["error"]


def test_truncates_and_reports_source_rows():
    rows = [["h1", "h2"]] + [[str(i), str(i * 2)] for i in range(600)]
    r = push_ingest({"rows": rows, "url": "https://shop.example.com/list"})
    assert r["ok"] is True
    assert r["truncated"] is True
    assert r["sourceRows"] == 601
    assert r["rows"] == 500
    job = pending_ingest()["job"]
    assert job["truncated"] is True
    assert len(job["rows"]) == 500


def test_amazon_ingest_sets_recipe_and_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(fr, "CONFIG_DIR", tmp_path)
    monkeypatch.setattr(fr, "RECIPES_DIR", tmp_path / "fetch-recipes")
    monkeypatch.setattr(fr, "RECIPE_FILE", tmp_path / "fetch-recipe-last.json")
    monkeypatch.setattr(fr, "DATA_DIR", tmp_path / "fetch-data")
    r = push_ingest({"rows": [["1", "title"]], "url": "https://www.amazon.com/s?k=bed"})
    assert r["ok"] is True
    assert r["projectReady"] is True
    assert r["recipePath"].endswith("amazon.com.json")
    assert r["dataPath"]
    assert "规整列" in r["reshapeHint"]
    job = pending_ingest()["job"]
    assert job["projectReady"] is True
    assert job["summary"]["rowCount"] == 1
