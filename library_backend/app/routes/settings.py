"""
阅读设置（全局 key-value 存储）

GET /api/settings          获取全部设置
PUT /api/settings          批量更新设置
"""
import json
from flask import Blueprint, request, jsonify
from app.database import get_db

bp = Blueprint('settings', __name__)

# 允许保存的 key 白名单，防止任意写入
ALLOWED_KEYS = {
    'font_size',
    'direction',
    'theme',
    'line_height',
    'turn_mode',
    'ai_provider',
    'book_reader_settings',
}


@bp.get('/api/settings')
def get_settings():
    conn = get_db()
    try:
        rows = conn.execute('SELECT key, value FROM settings').fetchall()
        result = {}
        for row in rows:
            try:
                result[row['key']] = json.loads(row['value'])
            except (json.JSONDecodeError, TypeError):
                result[row['key']] = row['value']
        return jsonify(result)
    finally:
        conn.close()


@bp.put('/api/settings')
def save_settings():
    data = request.get_json(silent=True) or {}
    unknown = set(data.keys()) - ALLOWED_KEYS
    if unknown:
        return jsonify({'error': f'不支持的设置项: {", ".join(unknown)}'}), 400

    conn = get_db()
    try:
        for key, value in data.items():
            conn.execute(
                """INSERT INTO settings (key, value) VALUES (?, ?)
                   ON CONFLICT(key) DO UPDATE SET value = excluded.value""",
                (key, json.dumps(value))
            )
        conn.commit()
        return jsonify({'updated': list(data.keys())})
    finally:
        conn.close()
