"""Chrome extension ingest queue."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

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
