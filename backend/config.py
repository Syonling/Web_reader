"""
后端配置管理
管理API密钥、服务设置等配置信息
"""
import os
from typing import Optional
from dotenv import load_dotenv

# 加载 .env 文件
load_dotenv()

class Config:
    """配置类"""
    
    # Flask 配置
    FLASK_HOST = os.getenv('FLASK_HOST', '0.0.0.0')
    FLASK_PORT = int(os.getenv('FLASK_PORT', 5001))
    FLASK_DEBUG = os.getenv('FLASK_DEBUG', 'True').lower() == 'true'
    
    # AI 服务配置
    AI_PROVIDER = os.getenv('AI_PROVIDER', 'echo')  # 可选: openai, claude, gemini, ollama, echo
    
    # OpenAI 配置
    OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
    OPENAI_MODEL = os.getenv('OPENAI_MODEL', 'gpt-4')
    OPENAI_BASE_URL = os.getenv('OPENAI_BASE_URL')  # 可选，用于代理或兼容接口
    
    # Anthropic Claude 配置
    ANTHROPIC_API_KEY = os.getenv('ANTHROPIC_API_KEY')
    ANTHROPIC_MODEL = os.getenv('ANTHROPIC_MODEL', 'claude-3-sonnet-20240229')
    
    # Google Gemini 配置
    GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
    GEMINI_MODEL = os.getenv('GEMINI_MODEL', 'gemini-pro')
    
    # Ollama 配置（本地模型）
    OLLAMA_BASE_URL = os.getenv('OLLAMA_BASE_URL', 'http://localhost:11434')
    OLLAMA_MODEL = os.getenv('OLLAMA_MODEL', 'llama2')

    # DeepSeek 配置
    DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY', '')
    DEEPSEEK_MODEL = os.getenv('DEEPSEEK_MODEL', 'deepseek-chat')
    
    # LLM 通用配置
    MAX_TOKENS = int(os.getenv('MAX_TOKENS', 1024))
    TEMPERATURE = float(os.getenv('TEMPERATURE', 0.7))
    TIMEOUT = int(os.getenv('TIMEOUT', 30))  # 秒
    
    @classmethod
    def validate(cls) -> tuple[bool, Optional[str]]:
        """验证配置是否完整"""
        if cls.AI_PROVIDER == 'openai' and not cls.OPENAI_API_KEY:
            return False, "缺少 OPENAI_API_KEY"
        elif cls.AI_PROVIDER == 'claude' and not cls.ANTHROPIC_API_KEY:
            return False, "缺少 ANTHROPIC_API_KEY"
        elif cls.AI_PROVIDER == 'gemini' and not cls.GEMINI_API_KEY:
            return False, "缺少 GEMINI_API_KEY"
        return True, None
    
    @classmethod
    def get_info(cls) -> dict:
        """获取配置信息（不包含敏感信息）"""
        return {
            'ai_provider': cls.AI_PROVIDER,
            'model': cls._get_current_model(),
            'max_tokens': cls.MAX_TOKENS,
            'temperature': cls.TEMPERATURE,
        }
    
    @classmethod
    def _get_current_model(cls) -> str:
        """获取当前使用的模型名称"""
        model_map = {
            'openai': cls.OPENAI_MODEL,
            'claude': cls.ANTHROPIC_MODEL,
            'gemini': cls.GEMINI_MODEL,
            'ollama': cls.OLLAMA_MODEL,
            'echo': 'echo (测试模式)'
        }
        return model_map.get(cls.AI_PROVIDER, '未知')