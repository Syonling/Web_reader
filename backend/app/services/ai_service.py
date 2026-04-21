"""
AI 文本分析服务（同步版本）
支持多种 LLM API：OpenAI, Claude, Gemini, Ollama
"""
import json, os, json, requests
from typing import Dict, Optional
from config import Config
from openai import OpenAI
# import anthropic
# import google.generativeai as genai

# ================================
# 基础分析器类
# ================================
class BaseAnalyzer:
    """LLM 分析器基类"""
    
    def __init__(self):
        self.config = Config
    
    def analyze(self, text: str) -> Dict:
        """分析文本（需要子类实现）"""
        raise NotImplementedError
    
    def _build_prompt(self, text: str) -> str:
        """构建分析提示词"""
        return f"""请分析以下文本，提供详细的语言学习辅助信息：

                文本: {text}

                请提供以下分析：
                1. 语言类型（中文/日文/英文）
                2. 翻译（如果是外语，翻译成中文；如果是中文，翻译成英文）
                3. 语法结构分析
                4. 重点词汇及解释
                5. 文化背景或使用场景说明

                请以JSON格式返回结果。"""

    def _load_prompt(self) -> str:
        """加载提示词文件"""
        prompt_path = os.path.join(os.path.dirname(__file__), "..", "..", "prompt.txt")
        try:
            with open(prompt_path, "r", encoding="utf-8") as f:
                return f.read()
        except FileNotFoundError:
            # ⭐ 返回默认 prompt，不能返回 None
            return """あなたは日本語の専門分析者です。
            JSON形式で以下の情報を返してください：
            {
            "translation": "中国語訳",
            "grammar_points": [],
            "vocabulary": [],
            "special_notes": []
            }"""

# ================================
# OpenAI 分析器
# ================================
class OpenAIAnalyzer(BaseAnalyzer):
    """OpenAI GPT 分析器"""
    
    def __init__(self):
        super().__init__()
        
        # 支持自定义 base_url（用于代理或兼容接口）
        client_kwargs = {'api_key': self.config.OPENAI_API_KEY}
        if self.config.OPENAI_BASE_URL:
            client_kwargs['base_url'] = self.config.OPENAI_BASE_URL
        
        self.client = OpenAI(**client_kwargs)
    
    def analyze(self, text: str) -> Dict:
        """使用 OpenAI API 分析文本"""
        try:
            prompt = self._load_prompt()
            response = self.client.chat.completions.create(
                model=self.config.OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text}
                ],
                response_format={"type": "json_object"},  # ⭐ 强制 JSON
                temperature=0.3
            )
            
            analysis = response.choices[0].message.content
            
            # 尝试解析为JSON，如果失败则返回原始文本
            # try:
            #     analysis_data = json.loads(content)
            # except json.JSONDecodeError:
            #     analysis_data = {'raw_response': content}
            
            return {
                # 'provider': 'OpenAI',
                # 'model': self.config.OPENAI_MODEL,
                'analysis': analysis,
                'tokens_used': response.usage.total_tokens,
                'status': 'success'
            }
            
        except Exception as e:
            return {
                'provider': 'OpenAI',
                'error': str(e),
                'status': 'error'
            }


# ================================
# Anthropic Claude 分析器
# ================================
class ClaudeAnalyzer(BaseAnalyzer):
    """Anthropic Claude 分析器"""
    
    def __init__(self):
        super().__init__()
        self.client = anthropic.Anthropic(api_key=self.config.ANTHROPIC_API_KEY)
    
    def analyze(self, text: str) -> Dict:
        response = self.client.messages.create(
            model=self.config.CLAUDE_MODEL,
            max_tokens=2000,
            messages=[
                {"role": "user", "content": f"{self._load_prompt()}\n\n{text}"}
            ]
        )
        
        # Claude 返回的 content 可能需要提取
        analysis = response.content[0].text
        
        # ⚠️ 确保是 JSON 字符串
        # 如果 Claude 返回了非 JSON，需要处理
        try:
            # 验证是否是有效 JSON
            json.loads(analysis)
        except:
            # 如果不是 JSON，包装一下
            analysis = json.dumps({
                "translation": "解析失败",
                "grammar_points": [],
                "vocabulary": [],
                "special_notes": [f"原始输出: {analysis}"]
            }, ensure_ascii=False)
        
        return {
            'provider': 'claude',
            'model': self.config.CLAUDE_MODEL,
            'analysis': analysis,  # ✅ JSON 字符串
            'tokens_used': response.usage.input_tokens + response.usage.output_tokens,
            'status': 'success'
        }


# ================================
# Google Gemini 分析器
# ================================
class GeminiAnalyzer(BaseAnalyzer):
    """Google Gemini 分析器"""
    
    def __init__(self):
        super().__init__()
        genai.configure(api_key=self.config.GEMINI_API_KEY)
        self.model = genai.GenerativeModel(self.config.GEMINI_MODEL)
    
    def analyze(self, text: str) -> Dict:
        generation_config = {
            "temperature": 0.3,
            "max_output_tokens": 2000,
            "response_mime_type": "application/json"  # ⭐ Gemini 的 JSON 模式
        }
        
        response = self.model.generate_content(
            f"{self._load_prompt()}\n\n{text}",
            generation_config=generation_config
        )
        
        analysis = response.text
        
        return {
            'provider': 'gemini',
            'model': self.config.GEMINI_MODEL,
            'analysis': analysis,  # ✅ JSON 字符串
            'tokens_used': 0,  # Gemini 可能需要从其他地方获取
            'status': 'success'
        }


# ================================
# Ollama 本地模型分析器
# ================================
class OllamaAnalyzer(BaseAnalyzer):
    """Ollama 本地模型分析器"""
    
    def __init__(self):
        super().__init__()
        self.base_url = self.config.OLLAMA_BASE_URL
        self.requests = requests
    
    def analyze(self, text: str) -> Dict:
        response = requests.post(
            f'{self.config.OLLAMA_BASE_URL}/api/generate',
            json={
                'model': self.config.OLLAMA_MODEL,
                'prompt': f"{self._load_prompt()}\n\n{text}",
                'format': 'json',  # ⭐ Ollama 的 JSON 模式
                'stream': False
            }
        )
        
        data = response.json()
        analysis = data.get('response', '{}')
        
        return {
            'provider': 'ollama',
            'model': self.config.OLLAMA_MODEL,
            'analysis': analysis,  # ✅ JSON 字符串
            'tokens_used': 0,
            'status': 'success'
        }


# ================================
# Echo 测试分析器（不调用实际API）
# ================================
class EchoAnalyzer(BaseAnalyzer):
    """Echo 分析器 - 用于测试，返回模拟的日语分析结果"""
    
    def analyze(self, text: str) -> Dict:
        """返回模拟的分析结果（统一格式）"""
        
        analysis_json = self._generate_japanese_mock(text)
        
        # 转换为 JSON 字符串（与 DeepSeek 格式一致）
        return {
            'provider': 'echo',
            'model': 'echo (测试模式)',
            'analysis': json.dumps(analysis_json, ensure_ascii=False),
            'tokens_used': 0,
            'status': 'success'
        }
    
    def _generate_japanese_mock(self, text: str) -> Dict:
        """生成日语模拟数据（统一格式）"""
        return {
            "translation": f"【模拟翻译】{text}（这是一个测试翻译）",
            "grammar_points": [
                {
                    "pattern": "〜ている",
                    "explanation": "表示动作的持续或结果状态（模拟语法点）",
                    "example_in_sentence": text[:10] if len(text) > 10 else text,
                    "level": "N2",
                    "is_special": False
                },
                {
                    "pattern": "〜られる",
                    "explanation": "表示被动或可能（模拟语法点）",
                    "example_in_sentence": text[:10] if len(text) > 10 else text,
                    "level": "N2",
                    "is_special": False
                }
            ],
            "vocabulary": [
                {
                    "word": text[:5] if len(text) >= 5 else text,
                    "reading": "もぎ",
                    "meaning": "模拟词汇",
                    "level": "N2",
                    "conjugation": {
                        "has_conjugation": True,
                        "original_form": "模拟原型",
                        "current_form": text[:5] if len(text) >= 5 else text,
                        "conjugation_type": "受身形＋ている",
                        "reason": "这是一个模拟的活用说明，用于测试 Echo 模式"
                    }
                },
                {
                    "word": "テスト",
                    "reading": "てすと",
                    "meaning": "测试",
                    "level": "N2",
                    "conjugation": {
                        "has_conjugation": False
                    }
                }
            ],
            "special_notes": [
                "⚠️ 这是 Echo 测试模式的模拟输出",
                "💡 配置真实的 API 密钥后，将返回实际的 AI 分析结果"
            ]
        }


# ================================
# Deepseek 分析器）
# ================================
class DeepSeekAnalyzer(BaseAnalyzer):
    """DeepSeek AI 分析器"""
    
    def __init__(self):
        super().__init__()
        # DeepSeek 使用 OpenAI 兼容接口
        
        self.client = OpenAI(
            api_key=self.config.DEEPSEEK_API_KEY,
            base_url="https://api.deepseek.com"
        )
    
    def analyze(self, text: str) -> Dict:
        """使用 DeepSeek 分析文本"""
        try:
            # 读取提示词
            prompt = self._load_prompt()
            
            response = self.client.chat.completions.create(
                model=self.config.DEEPSEEK_MODEL,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": text}
                ],
                response_format={"type": "json_object"},
                temperature=0.3,
                max_tokens=2000
            )
            
            analysis = response.choices[0].message.content
            
            return {
                # 'provider': 'deepseek',
                # 'model': self.config.DEEPSEEK_MODEL,
                'analysis': analysis,
                'tokens_used': response.usage.total_tokens if hasattr(response, 'usage') else 0,
                'status': 'success'
            }
            
        except Exception as e:
            return {
                'provider': 'deepseek',
                'error': str(e),
                'status': 'error'
            }
    


# ================================
# 分析器工厂
# ================================
class AnalyzerFactory:
    """分析器工厂类"""
    
    _analyzers = {
        'openai': OpenAIAnalyzer,
        'claude': ClaudeAnalyzer,
        'gemini': GeminiAnalyzer,
        'ollama': OllamaAnalyzer,
        'echo': EchoAnalyzer,
        'deepseek': DeepSeekAnalyzer,
    }
    
    @classmethod
    def create_analyzer(cls, provider: Optional[str] = None) -> BaseAnalyzer:
        """创建分析器实例"""
        provider = provider or Config.AI_PROVIDER
        
        analyzer_class = cls._analyzers.get(provider)
        if not analyzer_class:
            raise ValueError(f"不支持的 AI 提供商: {provider}")
        
        return analyzer_class()
    
    @classmethod
    def get_available_providers(cls) -> list:
        """获取可用的提供商列表"""
        return list(cls._analyzers.keys())


# ================================
# 主要的分析函数（同步）
# ================================
def analyze_text_with_ai(text: str, provider: Optional[str] = None) -> Dict:
    """
    使用AI分析文本（同步版本）
    
    Args:
        text: 要分析的文本
        provider: AI提供商 (可选)
    
    Returns:
        分析结果字典
    """
    try:
        analyzer = AnalyzerFactory.create_analyzer(provider)
        result = analyzer.analyze(text)
        return result
        
    except Exception as e:
        return {
            'provider': provider or Config.AI_PROVIDER,
            'error': str(e),
            'status': 'error'
        }