"""SQLite persistence for historical data."""
import sqlite3, json, os
from pathlib import Path

DB_PATH = Path.home() / ".claude-excel-web" / "data.db"

def _conn():
    os.makedirs(DB_PATH.parent, exist_ok=True)
    c = sqlite3.connect(str(DB_PATH))
    c.row_factory = sqlite3.Row
    return c

def init():
    c = _conn()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS datasets (
        id TEXT PRIMARY KEY, name TEXT, type TEXT, rows INTEGER, cols INTEGER,
        columns_json TEXT, uploaded_at TEXT
    );
    CREATE TABLE IF NOT EXISTS kpi_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id TEXT, date TEXT, vtr REAL, otr REAL,
        total_orders INTEGER, segment TEXT, carrier TEXT,
        extra_json TEXT
    );
    CREATE TABLE IF NOT EXISTS anomalies_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dataset_id TEXT, order_id TEXT, type TEXT, severity TEXT, detail TEXT, resolved INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS field_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, mapping_json TEXT, last_used_at TEXT
    );
    """)
    c.commit(); c.close()

def save_dataset(id: str, name: str, type: str, rows: int, cols: int, columns: list):
    c = _conn()
    c.execute("INSERT OR REPLACE INTO datasets VALUES(?,?,?,?,?,?,datetime('now'))",
              (id, name, type, rows, cols, json.dumps(columns)))
    c.commit(); c.close()

def save_kpi(dataset_id: str, kpi: dict, segment: str = "", carrier: str = ""):
    c = _conn()
    c.execute("INSERT INTO kpi_snapshots(dataset_id,date,vtr,otr,total_orders,segment,carrier,extra_json) VALUES(?,datetime('now'),?,?,?,?,?,?)",
              (dataset_id, kpi.get('vtr'), kpi.get('otr'), kpi.get('total_orders'), segment, carrier, json.dumps(kpi)))
    c.commit(); c.close()

def save_anomalies(dataset_id: str, anomalies: list):
    c = _conn()
    for a in anomalies:
        c.execute("INSERT INTO anomalies_log(dataset_id,order_id,type,severity,detail) VALUES(?,?,?,?,?)",
                  (dataset_id, a.get('order_id'), a.get('type'), a.get('severity'), a.get('detail')))
    c.commit(); c.close()

def save_mapping(name: str, mapping: dict):
    c = _conn()
    c.execute("INSERT INTO field_mappings(name,mapping_json,last_used_at) VALUES(?,?,datetime('now'))",
              (name, json.dumps(mapping)))
    c.commit(); c.close()

def get_history(days: int = 30) -> list:
    c = _conn()
    rows = c.execute("SELECT * FROM kpi_snapshots WHERE date >= datetime('now', ?) ORDER BY date DESC",
                     (f'-{days} days',)).fetchall()
    return [dict(r) for r in rows]

def get_recent_anomalies(limit: int = 50) -> list:
    c = _conn()
    rows = c.execute("SELECT * FROM anomalies_log ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]

init()
