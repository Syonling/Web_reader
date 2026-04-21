"""
健康监控服务
定时检查系统状态
"""
import threading
import time
import requests
import psutil
import os
from datetime import datetime
from config import Config
from app.utils.logger import health_logger


class HealthMonitor:
    """健康监控器"""
    
    def __init__(self, interval=1800):  # 默认30分钟
        self.interval = interval
        self.running = False
        self.thread = None
        self.start_time = datetime.now()
    
    def start(self):
        """启动监控"""
        if self.running:
            return
        
        self.running = True
        self.thread = threading.Thread(target=self._monitor_loop, daemon=True)
        self.thread.start()
        health_logger.info(f"健康监控已启动，检查间隔: {self.interval}秒")
    
    def stop(self):
        """停止监控"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        health_logger.info("健康监控已停止")
    
    def _monitor_loop(self):
        """监控循环"""
        # 首次延迟60秒
        time.sleep(10)
        
        while self.running:
            try:
                self._perform_health_check()
            except Exception as e:
                health_logger.error(f"健康检查失败: {str(e)}")
            
            time.sleep(self.interval)
    
    def _perform_health_check(self):
        """执行健康检查"""
        try:
            # 获取系统信息
            memory_info = psutil.virtual_memory()
            disk_info = psutil.disk_usage(os.getcwd())
            
            # 尝试访问自己的健康接口
            try:
                response = requests.get(
                    f'http://localhost:{Config.FLASK_PORT}/api/health',
                    timeout=5
                )
                api_status = 'ok' if response.status_code == 200 else 'error'
            except:
                api_status = 'unreachable'
            
            # 计算运行时间
            uptime = datetime.now() - self.start_time
            uptime_str = str(uptime).split('.')[0]  # 去掉微秒
            
            # 构建检查结果
            check_result = {
                'timestamp': datetime.now().isoformat(),
                'api_status': api_status,
                'provider': Config.AI_PROVIDER,
                'memory_used': f'{memory_info.percent}%',
                'memory_available': f'{memory_info.available / (1024**3):.2f}GB',
                'disk_free': f'{disk_info.free / (1024**3):.2f}GB',
                'uptime': uptime_str
            }
            
            # 记录日志
            log_message = (
                f"Health Check | "
                f"API: {check_result['api_status']} | "
                f"Provider: {check_result['provider']} | "
                f"Memory: {check_result['memory_used']} | "
                f"Disk: {check_result['disk_free']} | "
                f"Uptime: {check_result['uptime']}"
            )
            
            health_logger.info(log_message)
            
            # 如果有异常情况，发出警告
            if memory_info.percent > 90:
                health_logger.warning(f"内存使用率过高: {memory_info.percent}%")
            
            if disk_info.free / (1024**3) < 1:  # 少于1GB
                health_logger.warning(f"磁盘空间不足: {disk_info.free / (1024**3):.2f}GB")
            
        except Exception as e:
            health_logger.error(f"执行健康检查时出错: {str(e)}")


# 全局监控器实例
_monitor_instance = None


def start_monitoring(interval=1800):
    """
    启动健康监控
    
    Args:
        interval: 检查间隔（秒），默认1800秒（30分钟）
    """
    global _monitor_instance
    if _monitor_instance is None:
        _monitor_instance = HealthMonitor(interval)
        _monitor_instance.start()


def stop_monitoring():
    """停止健康监控"""
    global _monitor_instance
    if _monitor_instance:
        _monitor_instance.stop()
        _monitor_instance = None