"""
最近打开记录

GET /api/recent?limit=10    按 last_opened 降序返回最近 N 本书
"""
from flask import Blueprint, request, jsonify
from app.database import get_db

bp = Blueprint('recent', __name__)


@bp.get('/api/recent')
def get_recent():
    try:
        limit = max(1, min(50, int(request.args.get('limit', 10))))
    except (ValueError, TypeError):
        limit = 10

    conn = get_db()
    try:
        rows = conn.execute(
            'SELECT * FROM books ORDER BY last_opened DESC LIMIT ?', (limit,)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()
