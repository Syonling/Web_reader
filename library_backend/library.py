"""
书架后端 — 入口
"""
from app import create_app
from config import Config


def print_startup_info():
    print("\n" + "=" * 60)
    print(" 书架后端启动成功")
    print("=" * 60)
    print(f" 监听地址: http://{Config.FLASK_HOST}:{Config.FLASK_PORT}")
    print(f" 数据库:   {Config.DB_PATH}")
    print("-" * 60)
    print(" 可用接口:")
    print("   GET  /api/health")
    print("   GET  /api/recent?limit=10")
    print("   POST   /api/books")
    print("   GET    /api/books")
    print("   GET    /api/books/<id>")
    print("   DELETE /api/books/<id>")
    print("   GET    /api/books/<id>/progress")
    print("   PUT    /api/books/<id>/progress")
    print("   GET    /api/books/<id>/bookmarks")
    print("   POST   /api/books/<id>/bookmarks")
    print("   DELETE /api/books/<id>/bookmarks/<bid>")
    print("   GET    /api/settings")
    print("   PUT    /api/settings")
    print("-" * 60)
    print(f" 测试命令:")
    print(f"   curl http://localhost:{Config.FLASK_PORT}/api/health")
    print("=" * 60 + "\n")


if __name__ == '__main__':
    app = create_app()
    print_startup_info()
    app.run(
        host=Config.FLASK_HOST,
        port=Config.FLASK_PORT,
        debug=Config.FLASK_DEBUG,
    )
