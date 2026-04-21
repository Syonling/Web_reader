"""
请求日志中间件
自动记录所有API请求和响应
"""
import time
from flask import request, g
from app.utils.logger import access_logger, error_logger


class RequestLogger:
    """请求日志中间件"""
    
    def __init__(self, app=None):
        self.app = app
        if app is not None:
            self.init_app(app)
    
    def init_app(self, app):
        """初始化中间件"""
        app.before_request(self.before_request)
        app.after_request(self.after_request)
        app.teardown_request(self.teardown_request)
    
    @staticmethod
    def before_request():
        """请求开始时"""
        g.start_time = time.time() # 记录开始时间到全局对象
    
    @staticmethod
    def after_request(response):
        """请求结束时"""
        # 计算响应时间
        if hasattr(g, 'start_time'):
            response_time = time.time() - g.start_time
        else:
            response_time = 0
        
        # 构建日志信息
        log_data = {
            'method': request.method,       # POST
            'path': request.path,           # /api/analyze
            'status': response.status_code, # 200
            'response_time': f'{response_time:.3f}s',
            'ip': request.remote_addr,
        }
        
        # 记录分析请求的额外信息
        if request.path.startswith('/api/analyze'):
            try:
                data = request.get_json(silent=True)
                if data and 'text' in data:
                    text = data['text']
                    log_data['text_length'] = len(text)
                    log_data['text_preview'] = text[:50] + '...' if len(text) > 50 else text
            except:
                pass
        
        # 格式化日志消息
        log_message = (
            f"{log_data['method']} {log_data['path']} | "
            f"Status: {log_data['status']} | "
            f"Time: {log_data['response_time']} | "
            f"IP: {log_data['ip']}"
        )
        
        if 'text_length' in log_data:
            log_message += f" | TextLen: {log_data['text_length']}"
        
        # 记录日志
        if response.status_code >= 400:
            error_logger.error(log_message)
        else:
            access_logger.info(log_message)
        
        return response
    
    @staticmethod
    def teardown_request(exception=None):
        """请求清理时"""
        if exception:
            error_logger.exception(f"请求处理异常: {str(exception)}")


def init_request_logger(app):
    """初始化请求日志器"""
    RequestLogger(app)