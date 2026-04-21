"""
应用程序主包
"""
from flask import Flask
from flask_cors import CORS

def create_app():
    """创建并配置 Flask 应用"""
    app = Flask(__name__)
    CORS(app)
    
    # 初始化日志中间件
    from app.middleware.request_logger import init_request_logger
    init_request_logger(app)
    
    # 注册蓝图
    from app.routes import health, analysis, stats
    app.register_blueprint(health.bp)
    app.register_blueprint(analysis.bp)
    app.register_blueprint(stats.bp)
    
    return app