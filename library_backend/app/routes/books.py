"""
书架 CRUD

POST /api/books               添加书籍
GET  /api/books               列出全部书籍
GET  /api/books/<id>          获取单本详情
DELETE /api/books/<id>        从书架移除
"""
import time
from flask import Blueprint, request, jsonify
from app.database import get_db

bp = Blueprint('books', __name__)


@bp.post('/api/books')
def add_book():
    data = request.get_json(silent=True) or {}
    book_id   = data.get('id', '').strip()
    title     = data.get('title', '').strip()
    file_name = data.get('file_name', '').strip()

    if not book_id or not title or not file_name:
        return jsonify({'error': '缺少必填字段: id, title, file_name'}), 400

    now = int(time.time())
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO books (id, title, file_name, file_size, format, added_at, last_opened)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 title       = excluded.title,
                 last_opened = excluded.last_opened""",
            (
                book_id, title, file_name,
                int(data.get('file_size', 0)),
                data.get('format', 'epub'),
                now, now,
            )
        )
        conn.commit()
        return jsonify({'id': book_id}), 201
    finally:
        conn.close()


@bp.get('/api/books')
def list_books():
    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM books ORDER BY last_opened DESC'
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


@bp.get('/api/books/<book_id>')
def get_book(book_id):
    conn = get_db()
    try:
        row = conn.execute(
            'SELECT * FROM books WHERE id = ?', (book_id,)
        ).fetchone()
        if not row:
            return jsonify({'error': '书籍不存在'}), 404
        return jsonify(dict(row))
    finally:
        conn.close()


@bp.delete('/api/books/<book_id>')
def delete_book(book_id):
    conn = get_db()
    try:
        cur = conn.execute('DELETE FROM books WHERE id = ?', (book_id,))
        conn.commit()
        if cur.rowcount == 0:
            return jsonify({'error': '书籍不存在'}), 404
        return jsonify({'deleted': book_id})
    finally:
        conn.close()
