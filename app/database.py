"""SQLite 持久层：保存的排班刷新（及容器重启）后仍可查看。"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_PATH = Path(os.environ.get("DB_PATH", "/data/rotation.db"))


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schedules (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                config     TEXT NOT NULL,
                result     TEXT NOT NULL,
                status     TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )
            """
        )


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def insert_schedule(name: str, config: str, result: str, status: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO schedules (name, config, result, status) VALUES (?, ?, ?, ?)",
            (name, config, result, status),
        )
        return int(cur.lastrowid)


def list_schedules() -> list[sqlite3.Row]:
    with get_conn() as conn:
        return list(
            conn.execute(
                "SELECT id, name, status, created_at FROM schedules "
                "ORDER BY id DESC"
            )
        )


def get_schedule(schedule_id: int) -> sqlite3.Row | None:
    with get_conn() as conn:
        return conn.execute(
            "SELECT * FROM schedules WHERE id = ?", (schedule_id,)
        ).fetchone()


def delete_schedule(schedule_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
        return cur.rowcount > 0
