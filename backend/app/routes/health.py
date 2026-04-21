"""
健康检查和配置路由
"""
from flask import Blueprint, jsonify
from datetime import datetime
from config import Config
from app.services.ai_service import AnalyzerFactory

bp = Blueprint('health', __name__)


@bp.route('/api/health', methods=['GET'])
def health_check():
    """健康检查接口"""
    config_info = Config.get_info()
    
    return jsonify({
        'status': 'ok',
        'message': '✅ 后端运行正常',
        'config': config_info,
        'available_providers': AnalyzerFactory.get_available_providers(),
        'timestamp': datetime.now().isoformat()
    }), 200


@bp.route('/api/config', methods=['GET'])
def get_config():
    """获取当前配置信息（不包含敏感信息）"""
    return jsonify({
        'config': Config.get_info(),
        'available_providers': AnalyzerFactory.get_available_providers(),
        'timestamp': datetime.now().isoformat()
    }), 200


@bp.route('/api/providers', methods=['GET'])
def get_providers():
    """
    获取所有可用的AI提供商及其状态
    """
    current_provider = Config.AI_PROVIDER
    
    providers = [
        {
            'id': 'echo',
            'name': 'Echo',
            'display_name': 'Echo (测试)',
            'requires_key': False,
            'status': 'ready'
        },
        {
            'id': 'openai',
            'name': 'OpenAI',
            'display_name': 'OpenAI (GPT-4)',
            'requires_key': True,
            'status': 'configured' if Config.OPENAI_API_KEY else 'needs_key'
        },
        {
            'id': 'claude',
            'name': 'Claude',
            'display_name': 'Claude (Anthropic)',
            'requires_key': True,
            'status': 'configured' if Config.ANTHROPIC_API_KEY else 'needs_key'
        },
        {
            'id': 'gemini',
            'name': 'Gemini',
            'display_name': 'Gemini (Google)',
            'requires_key': True,
            'status': 'configured' if Config.GEMINI_API_KEY else 'needs_key'
        },
        # {
        #     'id': 'ollama',
        #     'name': 'Ollama',
        #     'display_name': 'Ollama (本地)',
        #     'requires_key': False,
        #     'status': 'ready'
        # },
        {
            'id': 'deepseek',  
            'name': 'DeepSeek',
            'display_name': 'DeepSeek',
            'requires_key': True,
            'status': 'configured' if Config.DEEPSEEK_API_KEY else 'needs_key'
        },        
    ]
    
    return jsonify({
        'current': current_provider,
        'providers': providers,
        'timestamp': datetime.now().isoformat()
    }), 200