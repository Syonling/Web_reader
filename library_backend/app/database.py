"""
SQLite 连接与初始化
"""
import sqlite3
import os
from config import Config


def get_db() -> sqlite3.Connection:
    """返回已启用 WAL 模式和 Row 工厂的连接（调用方负责关闭）。"""
    os.makedirs(os.path.dirname(Config.DB_PATH), exist_ok=True)
    conn = sqlite3.connect(Config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL')
    conn.execute('PRAGMA foreign_keys=ON')
    return conn


def init_db():
    """建表（幂等，表已存在则跳过）。"""
    conn = get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS books (
                id          TEXT    PRIMARY KEY,
                title       TEXT    NOT NULL,
                file_name   TEXT    NOT NULL,
                file_size   INTEGER NOT NULL DEFAULT 0,
                format      TEXT    NOT NULL DEFAULT 'epub',
                added_at    INTEGER NOT NULL,
                last_opened INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS progress (
                book_id       TEXT    PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
                chapter_index INTEGER NOT NULL DEFAULT 0,
                page_num      INTEGER NOT NULL DEFAULT 0,
                updated_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bookmarks (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                book_id       TEXT    NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                chapter_index INTEGER NOT NULL DEFAULT 0,
                page_num      INTEGER NOT NULL DEFAULT 0,
                label         TEXT,
                created_at    INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
        """)
        conn.commit()
    finally:
        conn.close()
