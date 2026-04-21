"""
日志配置模块
配置日志格式、文件位置、轮转策略
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from datetime import datetime


class LoggerConfig:
    """日志配置类"""
    
    # 日志目录
    LOG_DIR = 'logs'
    
    # 日志文件
    APP_LOG = os.path.join(LOG_DIR, 'app.log')
    ACCESS_LOG = os.path.join(LOG_DIR, 'access.log')
    ERROR_LOG = os.path.join(LOG_DIR, 'error.log')
    HEALTH_LOG = os.path.join(LOG_DIR, 'health_check.log')
    
    # 日志格式
    DETAILED_FORMAT = '%(asctime)s | %(levelname)s | %(name)s | %(message)s'
    SIMPLE_FORMAT = '%(asctime)s | %(message)s'
    
    # 日志轮转配置
    MAX_BYTES = 10 * 1024 * 1024  # 10MB
    BACKUP_COUNT = 10
    
    @classmethod
    def setup(cls):
        """初始化日志系统"""
        # 创建日志目录
        os.makedirs(cls.LOG_DIR, exist_ok=True)
        
        # 配置根日志器
        logging.basicConfig(
            level=logging.INFO,
            format=cls.DETAILED_FORMAT,
            datefmt='%Y-%m-%d %H:%M:%S'
        )
    
    @classmethod
    def get_logger(cls, name: str, log_file: str = None) -> logging.Logger:
        """
        获取日志器
        
        Args:
            name: 日志器名称
            log_file: 日志文件路径（可选）
        
        Returns:
            配置好的日志器
        """
        logger = logging.getLogger(name)
        logger.setLevel(logging.INFO)
        
        # 如果指定了日志文件，添加文件处理器
        if log_file:
            file_handler = RotatingFileHandler(
                log_file,
                maxBytes=cls.MAX_BYTES,
                backupCount=cls.BACKUP_COUNT,
                encoding='utf-8'
            )
            file_handler.setFormatter(logging.Formatter(cls.DETAILED_FORMAT))
            logger.addHandler(file_handler)
        
        return logger


# 创建各个日志器
app_logger = LoggerConfig.get_logger('app', LoggerConfig.APP_LOG)
access_logger = LoggerConfig.get_logger('access', LoggerConfig.ACCESS_LOG)
error_logger = LoggerConfig.get_logger('error', LoggerConfig.ERROR_LOG)
health_logger = LoggerConfig.get_logger('health', LoggerConfig.HEALTH_LOG)


# 初始化日志系统
LoggerConfig.setup()