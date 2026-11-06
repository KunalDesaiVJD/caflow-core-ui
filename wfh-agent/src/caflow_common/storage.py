"""SQLite metadata store + screenshot file writing + retention purge."""
from __future__ import annotations

import hashlib
import sqlite3
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .paths import Storage

_SCHEMA = """
CREATE TABLE IF NOT EXISTS captures (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          INTEGER NOT NULL,           -- unix seconds
    employee_id TEXT    NOT NULL,
    device_id   TEXT    NOT NULL,
    display_no  INTEGER NOT NULL,
    path        TEXT    NOT NULL,           -- relative to storage.screens
    sha256      TEXT    NOT NULL,
    bytes       INTEGER NOT NULL,
    app         TEXT,
    title       TEXT,
    idle        INTEGER NOT NULL DEFAULT 0  -- 1 if idle at capture time
);
CREATE INDEX IF NOT EXISTS idx_captures_ts ON captures(ts);
"""


class Store:
    def __init__(self, storage: Storage, employee_id: str, device_id: str):
        self.s = storage
        self.employee_id = employee_id
        self.device_id = device_id
        self.s.ensure()
        self._conn = sqlite3.connect(str(self.s.db), check_same_thread=False)
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def save_screenshot(
        self,
        display_no: int,
        image_bytes: bytes,
        app: Optional[str],
        title: Optional[str],
        idle: bool,
        ts: Optional[int] = None,
    ) -> Path:
        ts = ts or int(time.time())
        day = datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
        day_dir = self.s.screens_for_day(day)
        day_dir.mkdir(parents=True, exist_ok=True)
        fname = f"{ts}_{display_no}.webp"
        full = day_dir / fname
        full.write_bytes(image_bytes)
        sha = hashlib.sha256(image_bytes).hexdigest()
        rel = str(Path(day) / fname)
        self._conn.execute(
            "INSERT INTO captures(ts,employee_id,device_id,display_no,path,sha256,bytes,app,title,idle)"
            " VALUES(?,?,?,?,?,?,?,?,?,?)",
            (ts, self.employee_id, self.device_id, display_no, rel, sha,
             len(image_bytes), app, title, 1 if idle else 0),
        )
        self._conn.commit()
        return full

    def count_today(self) -> int:
        start = int(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp())
        cur = self._conn.execute("SELECT COUNT(*) FROM captures WHERE ts>=?", (start,))
        return int(cur.fetchone()[0])

    def purge_older_than(self, days: int) -> int:
        """Delete rows + screenshot files older than `days`. Returns files removed."""
        cutoff = int((datetime.now() - timedelta(days=days)).timestamp())
        removed = 0
        cur = self._conn.execute("SELECT id, path FROM captures WHERE ts < ?", (cutoff,))
        rows = cur.fetchall()
        for row_id, rel in rows:
            f = self.s.screens / rel
            try:
                if f.exists():
                    f.unlink()
                    removed += 1
            except OSError:
                pass
            self._conn.execute("DELETE FROM captures WHERE id=?", (row_id,))
        self._conn.commit()
        # remove now-empty day directories
        for day_dir in list(self.s.screens.glob("*")):
            try:
                if day_dir.is_dir() and not any(day_dir.iterdir()):
                    day_dir.rmdir()
            except OSError:
                pass
        return removed

    def close(self) -> None:
        try:
            self._conn.close()
        except Exception:
            pass
