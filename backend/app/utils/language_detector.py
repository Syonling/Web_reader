"""
语言检测工具
"""

def is_single_word(text: str) -> bool:
    """
    判断是否为单个词汇
    
    Args:
        text: 输入文本
    
    Returns:
        True: 单个词汇, False: 句子或短语
    """
    text = text.strip()
    
    # 规则1: 非常短（1-20个字符）
    if len(text) > 10:
        print("\n====输入是句子====\n")
        return False
    else:
        print("\n!!!!输入是单词!!!!\n")
        return True