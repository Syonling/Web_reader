"""
书签

GET    /api/books/<id>/bookmarks        列出书签
POST   /api/books/<id>/bookmarks        添加书签
DELETE /api/books/<id>/bookmarks/<bid>  删除书签
"""
import time
from flask import Blueprint, request, jsonify
from app.database import get_db

bp = Blueprint('bookmarks', __name__)


@bp.get('/api/books/<book_id>/bookmarks')
def list_bookmarks(book_id):
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM bookmarks WHERE book_id = ? ORDER BY created_at DESC',
            (book_id,)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@bp.post('/api/books/<book_id>/bookmarks')
def add_bookmark(book_id):
    data          = request.get_json(silent=True) or {}
    chapter_index = int(data.get('chapter_index', 0))
    page_num      = int(data.get('page_num', 0))
    label         = data.get('label', '').strip() or None
    now           = int(time.time())

    conn = get_db()
    try:
        exists = conn.execute(
            'SELECT 1 FROM books WHERE id = ?', (book_id,)
        ).fetchone()
        if not exists:
            return jsonify({'error': '书籍不存在'}), 404

        cur = conn.execute(
            """INSERT INTO bookmarks (book_id, chapter_index, page_num, label, created_at)
               VALUES (?, ?, ?, ?, ?)""",
            (book_id, chapter_index, page_num, label, now)
        )
        conn.commit()
        return jsonify({'id': cur.lastrowid, 'book_id': book_id,
                        'chapter_index': chapter_index, 'page_num': page_num,
                        'label': label}), 201
    finally:
        conn.close()


@bp.delete('/api/books/<book_id>/bookmarks/<int:bookmark_id>')
def delete_bookmark(book_id, bookmark_id):
    conn = get_db()
    try:
        cur = conn.execute(
            'DELETE FROM bookmarks WHERE id = ? AND book_id = ?',
            (bookmark_id, book_id)
        )
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'error': '书签不存在'}), 404
        return jsonify({'deleted': bookmark_id})
    finally:
        conn.close()
