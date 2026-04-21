"""
修改后的 word_parser.py
集成词典和动词变形功能
"""
from typing import Dict
import json


class WordParser:
    """单词解析器 - 支持日语词典和动词变形"""
    
    def __init__(self):
        self.japanese_parser = self._init_japanese_parser()
    
    def _init_japanese_parser(self):
        """初始化日语解析器"""
        try:
            from app.services.japanese_word_parser import get_japanese_parser
            return get_japanese_parser()
        except ImportError:
            print("⚠️ 日语解析器未找到")
            return None
    
    def parse(self, word: str, language: str = None) -> Dict:
        """
        解析单词
        
        Args:
            word: 要解析的单词
            language: 语言类型（可选）
        
        Returns:
            统一格式的解析结果（Dict对象，不是JSON字符串！）
        """
        # 如果没有指定语言，自动检测
        if not language:
            language = self._detect_language(word)
        
        # 根据语言调用不同的解析器
        if language == '日文':
            return self._parse_japanese(word)
        else:
            # 其他语言暂不支持
            return {
                "translation": f"暂不支持{language}的词典查询",
                "grammar_points": [],
                "vocabulary": [{
                    "word": word,
                    "reading": "",
                    "meaning": "（暂不支持）",
                    "level": "N2",
                    "conjugation": {
                        "has_conjugation": False
                    }
                }],
                "special_notes": [
                    f"⚠️ 目前仅支持日语单词分析",
                    f"💡 检测到的语言: {language}"
                ]
            }
    
    def _detect_language(self, word: str) -> str:
        """检测语言"""
        # 检测日文字符
        if any('\u3040' <= c <= '\u309F' or  # 平假名
               '\u30A0' <= c <= '\u30FF' or  # 片假名
               '\u4E00' <= c <= '\u9FFF'     # 汉字
               for c in word):
            # 如果有平假名或片假名，判断为日文
            if any('\u3040' <= c <= '\u309F' or '\u30A0' <= c <= '\u30FF' for c in word):
                return '日文'
        
        # 检测中文字符
        if any('\u4E00' <= c <= '\u9FFF' for c in word):
            return '中文'
        
        # 检测英文
        if all(c.isalpha() or c.isspace() for c in word):
            return '英文'
        
        return '未知'
    
    def _parse_japanese(self, word: str) -> Dict:
        """
        解析日文单词（返回Dict对象）
        
        使用 japanese_word_parser 进行完整分析
        """
        if self.japanese_parser:
            # 使用完整的日语解析器（返回Dict，不是JSON字符串）
            return self.japanese_parser.parse(word)
        else:
            # 降级到简单解析
            return self._parse_japanese_fallback(word)
    
    def _parse_japanese_fallback(self, word: str) -> Dict:
        """
        日语解析降级方案（无词典时）
        """
        result = {
            "translation": f"（无法查询词典）",
            "grammar_points": [],
            "vocabulary": [{
                "word": word,
                "reading": "（需要安装词典）",
                "meaning": "（需要安装词典）",
                "level": "N2",
                "conjugation": {
                    "has_conjugation": False
                }
            }],
            "special_notes": [
                "⚠️ 词典功能未安装",
                "💡 安装方法:",
                "   poetry add jamdict",
                "   poetry add sudachipy sudachidict_core"
            ]
        }
        
        return result


# 全局单例
_parser_instance = None


def get_word_parser():
    """获取单词解析器单例"""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = WordParser()
    return _parser_instance