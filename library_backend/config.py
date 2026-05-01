"""
书架后端配置
"""
import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    FLASK_HOST  = os.getenv('LIBRARY_HOST', '0.0.0.0')
    FLASK_PORT  = int(os.getenv('LIBRARY_PORT', 5002))
    FLASK_DEBUG = os.getenv('LIBRARY_DEBUG', 'True').lower() == 'true'

    # SQLite 数据库文件路径（默认放在 library_backend/ 目录下）
    _base_dir   = os.path.dirname(os.path.abspath(__file__))
    DB_PATH     = os.getenv('LIBRARY_DB_PATH', os.path.join(_base_dir, 'data', 'library.db'))

    # CORS：允许前端页面（本地文件 / 开发服务器）访问
    CORS_ORIGINS = os.getenv('LIBRARY_CORS_ORIGINS', '*')
