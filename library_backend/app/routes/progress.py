"""
阅读进度

GET /api/books/<id>/progress   获取进度
PUT /api/books/<id>/progress   保存进度
"""
import time
from flask import Blueprint, request, jsonify
from app.database import get_db

bp = Blueprint('progress', __name__)


@bp.get('/api/books/<book_id>/progress')
def get_progress(book_id):
    conn = get_db()
    try:
        row = conn.execute(
            'SELECT * FROM progress WHERE book_id = ?', (book_id,)
        ).fetchone()
        if not row:
            return jsonify({'book_id': book_id, 'chapter_index': 0, 'page_num': 0})
        return jsonify(dict(row))
    finally:
        conn.close()


@bp.put('/api/books/<book_id>/progress')
def save_progress(book_id):
    data          = request.get_json(silent=True) or {}
    chapter_index = int(data.get('chapter_index', 0))
    page_num      = int(data.get('page_num', 0))
    now           = int(time.time())

    conn = get_db()
    try:
        # 书籍不存在时拒绝写入，避免孤儿记录
        exists = conn.execute(
            'SELECT 1 FROM books WHERE id = ?', (book_id,)
        ).fetchone()
        if not exists:
            return jsonify({'error': '书籍不存在，请先调用 POST /api/books 注册'}), 404

        conn.execute(
            """INSERT INTO progress (book_id, chapter_index, page_num, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(book_id) DO UPDATE SET
                 chapter_index = excluded.chapter_index,
                 page_num      = excluded.page_num,
                 updated_at    = excluded.updated_at""",
            (book_id, chapter_index, page_num, now)
        )
        # 同步更新 last_opened
        conn.execute(
            'UPDATE books SET last_opened = ? WHERE id = ?', (now, book_id)
        )
        conn.commit()
        return jsonify({'book_id': book_id, 'chapter_index': chapter_index, 'page_num': page_num})
    finally:
        conn.close()
