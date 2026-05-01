"""
书架后端应用包
"""
from flask import Flask
from flask_cors import CORS
from config import Config
from app.database import init_db


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app, origins=Config.CORS_ORIGINS)

    # 确保数据库和表已就绪
    init_db()

    # 注册路由蓝图
    from app.routes import health, books, progress, bookmarks, settings, recent
    app.register_blueprint(health.bp)
    app.register_blueprint(books.bp)
    app.register_blueprint(progress.bp)
    app.register_blueprint(bookmarks.bp)
    app.register_blueprint(settings.bp)
    app.register_blueprint(recent.bp)

    return app
