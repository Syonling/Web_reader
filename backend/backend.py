"""
EPUB Reader 后端服务 - 主文件
"""
import os
from app import create_app
from app.services.health_monitor import start_monitoring
from config import Config


def print_startup_info():
    """打印启动信息"""
    print("\n" + "="*70)
    print(" EPUB Reader 后端服务启动成功！")
    print("="*70)
    print(f" 监听地址: http://{Config.FLASK_HOST}:{Config.FLASK_PORT}")
    print(f" AI提供商: {Config.AI_PROVIDER}")
    print(f" 当前模型: {Config.get_info()['model']}")
    print("-"*70)
    print(" 可用接口:")
    print(f"   - GET  /api/health              健康检查")
    print(f"   - GET  /api/config              获取配置")
    print(f"   - GET  /api/providers           获取提供商列表")
    print(f"   - GET  /api/stats               查看统计信息")
    print(f"   - POST /api/analyze             智能分析（自动判断）")
    print(f"   - POST /api/analyze/word        单词解析（强制）")
    print(f"   - POST /api/analyze/sentence    句子分析（强制）")
    print(f"   - POST /api/switch-provider     切换AI提供商")
    print("-"*70)
    print(f" 日志功能:")
    print(f"   - 请求日志: logs/access.log")
    print(f"   - 错误日志: logs/error.log")
    print(f"   - 健康日志: logs/health_check.log (每30分钟)")
    print("-"*70)
    print(f" 测试命令:")
    print(f"   curl http://localhost:{Config.FLASK_PORT}/api/health")
    print("="*70)
    
    if Config.AI_PROVIDER == 'echo':
        print("  当前使用 Echo 测试模式")
        print(" 配置真实的AI API密钥以使用实际AI分析功能")
        print("   在 .env 文件中设置相应的 API_KEY")
        print("="*70)
    
    print()


if __name__ == '__main__':
    app = create_app()
    
    # 只在主进程启动监控（不在reloader进程）
    if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
        start_monitoring(interval=1800)
    
    print_startup_info()
    
    # 启动服务
    app.run(
        host=Config.FLASK_HOST,
        port=Config.FLASK_PORT,
        debug=Config.FLASK_DEBUG    #调试自动reload开关，调试结束后一定要关闭 (.env)
    )