"""
文本分析协调器
负责判断使用单词解析还是AI分析
"""
from typing import Dict
from app.utils.language_detector import is_single_word
from app.services.word_parser import get_word_parser
from app.services.ai_service import analyze_text_with_ai


class TextAnalyzer:
    """文本分析协调器"""
    
    def __init__(self):
        self.word_parser = get_word_parser()
    
    def analyze(self, text: str, force_type: str = None) -> Dict:
        """
        分析文本
        
        Args:
            text: 要分析的文本
            force_type: 强制使用的分析类型 ('word' 或 'sentence')，None 则自动判断
        
        Returns:
            分析结果字典
        """
        text = text.strip()
        
        # 决定分析类型
        if force_type == 'word':
            analysis_type = 'word'
        elif force_type == 'sentence':
            analysis_type = 'sentence'
        else:
            # 自动判断
            analysis_type = 'word' if is_single_word(text) else 'sentence'
        
        # 执行相应的分析
        if analysis_type == 'word':
            result = self._analyze_word(text)
        else:
            result = self._analyze_sentence(text)
        
        # 添加元数据
        result['text'] = text
        result['analysis_type'] = analysis_type
        # result['language'] = detect_language(text)
        result['character_count'] = len(text)
        
        return result
    
    def _analyze_word(self, text: str) -> Dict:
        """使用单词解析器分析"""
        try:
            word_info = self.word_parser.parse(text)
            return {
                'method': 'word_parser',
                'result': word_info,
                'status': 'success'
            }
        except Exception as e:
            return {
                'method': 'word_parser',
                'error': str(e),
                'status': 'error'
            }
    
    def _analyze_sentence(self, text: str) -> Dict:
        """使用AI分析句子"""
        try:
            ai_result = analyze_text_with_ai(text)
            print(ai_result)
            return {
                'method': 'ai_analysis',
                # 'provider': ai_result.get('provider'),
                # 'model': ai_result.get('model'),
                'result': ai_result.get('analysis'),
                'status': ai_result.get('status')
            }
        except Exception as e:
            return {
                'method': 'ai_analysis',
                'error': str(e),
                'status': 'error'
            }


# 单例模式
_text_analyzer_instance = None

def get_text_analyzer() -> TextAnalyzer:
    """获取文本分析器实例"""
    global _text_analyzer_instance
    if _text_analyzer_instance is None:
        _text_analyzer_instance = TextAnalyzer()
    return _text_analyzer_instance