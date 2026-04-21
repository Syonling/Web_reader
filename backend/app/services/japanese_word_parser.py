"""
日语单词分析器 - 最终版
使用字符级映射算法，简单可靠
"""
import json
from typing import Dict, List, Optional
from sudachipy import tokenizer, dictionary


class JapaneseWordParser:
    """日语单词解析器"""
    
    def __init__(self):
        self.jamdict = self._import_jamdict()
        self.sudachi = self._import_sudachi()
    
    def _import_jamdict(self):
        """导入 jamdict 词典库"""
        try:
            from jamdict import Jamdict
            return Jamdict()
        except ImportError:
            print("⚠️ jamdict 未安装，词典功能将受限")
            return None
    
    def _import_sudachi(self):
        """导入 sudachi 形态分析库"""
        try:
            tokenizer_obj = dictionary.Dictionary().create()
            return tokenizer_obj
        except ImportError:
            print("⚠️ sudachipy 未安装，形态分析功能将受限")
            return None

    def _get_full_reading(self, tokens):
        """将所有形态素的读音拼接成完整读音（解决读音缺失问题）"""
        readings = []
        for t in tokens:
            r = t.reading_form()
            if r != "*":
                readings.append(r)
        full = "".join(readings)
        return self._katakana_to_hiragana(full)
    
    def _katakana_to_hiragana(self, text: str) -> str:
        """将片假名转换为平假名"""
        result = []
        for char in text:
            code = ord(char)
            if 0x30A0 <= code <= 0x30FF:
                result.append(chr(code - 0x60))
            else:
                result.append(char)
        return ''.join(result)

    def _generate_complete_reading(self, surface: str, dictionary_form: str, dictionary_reading: str) -> str:
        """
        字符级映射算法 - 简单可靠
        
        步骤：
        1. 遍历 dictionary_form，建立【汉字→读音】映射
        2. 用映射替换 surface 中的汉字，假名保持原样
        """
        # 快速路径
        if surface == dictionary_form:
            return dictionary_reading
        
        # 建立汉字到读音的映射
        kanji_to_reading = {}
        reading_idx = 0
        
        for i, char in enumerate(dictionary_form):
            if '\u4e00' <= char <= '\u9fff':  # 汉字
                # 提取这个汉字的读音（读到下一个假名为止）
                kanji_reading = ""
                
                while reading_idx < len(dictionary_reading):
                    next_char = dictionary_reading[reading_idx]
                    
                    # 检查：是否遇到 dictionary_form 中后续的假名
                    # 如果遇到，说明汉字读音结束
                    found_kana_in_dict = False
                    for j in range(i + 1, len(dictionary_form)):
                        if dictionary_form[j] == next_char and ('\u3040' <= next_char <= '\u309f'):
                            found_kana_in_dict = True
                            break
                    
                    if found_kana_in_dict:
                        break
                    
                    kanji_reading += next_char
                    reading_idx += 1
                
                kanji_to_reading[char] = kanji_reading
            else:
                # 假名，在 reading 中跳过对应位置
                if reading_idx < len(dictionary_reading) and dictionary_reading[reading_idx] == char:
                    reading_idx += 1
        
        # 用映射替换 surface 中的汉字
        result = ""
        for char in surface:
            if '\u4e00' <= char <= '\u9fff':  # 汉字
                result += kanji_to_reading.get(char, char)
            else:  # 假名直接保留
                result += char
        
        return result
        
    def parse(self, word: str) -> Dict:
        """解析日语单词"""
        original_form = self._get_original_form(word)
        search_word = original_form if original_form else word
        
        morphology = self._analyze_with_sudachi(word) if self.sudachi else None
        dict_results = self._lookup_dict(search_word) if self.jamdict else None
        
        if not dict_results and original_form:
            dict_results = self._lookup_dict(word) if self.jamdict else None
        
        result = self._build_unified_result(word, morphology, dict_results)
        
        if original_form and original_form != word:
            result['special_notes'].insert(0, f"💡 已自动查询原型：{original_form}")
        
        return result
    
    def _get_original_form(self, word: str) -> Optional[str]:
        """获取单词的原型（辞书形）"""
        if not self.sudachi:
            return None
        
        try:
            from sudachipy import tokenizer
            tokens = self.sudachi.tokenize(word, tokenizer.Tokenizer.SplitMode.C)
            
            if tokens:
                dictionary_form = tokens[0].dictionary_form()
                if dictionary_form != word:
                    return dictionary_form
            
            return None
        except Exception as e:
            return None
    
    def _analyze_with_sudachi(self, word: str) -> Optional[Dict]:
        """使用 Sudachi 进行形态分析"""
        try:
            from sudachipy import tokenizer
            
            tokens = self.sudachi.tokenize(word, tokenizer.Tokenizer.SplitMode.C)
            
            if not tokens:
                return None
            
            token = tokens[0]
            surface = "".join(t.surface() for t in tokens)   # 用全部 morphemes 生成 surface
            dictionary_form = token.dictionary_form()

            # 用新的完整读音函数
            surface_reading = self._get_full_reading(tokens)
            pos_tags = token.part_of_speech()
            return {
                'surface': surface,
                'dictionary_form': dictionary_form,
                'surface_reading': surface_reading,   # ← 添加
                'dictionary_reading': token.reading_form(),  # ← 添加
                'normalized_form': token.normalized_form(),
                'pos': pos_tags,
                'pos_type': self._classify_pos(pos_tags),
                'verb_type': self._get_verb_type(pos_tags),
                'verb_form': self._get_verb_form(pos_tags),
            }
        except Exception as e:
            return None
    
    def _classify_pos(self, pos_tags: List[str]) -> str:
        """分类词性"""
        if not pos_tags:
            return 'unknown'
        
        main_pos = pos_tags[0]
        
        if main_pos == '動詞':
            return 'verb'
        elif main_pos == '形容詞':
            return 'i_adjective'
        elif main_pos == '形状詞':
            return 'na_adjective'
        elif main_pos == '名詞':
            return 'noun'
        elif main_pos == '副詞':
            return 'adverb'
        else:
            return main_pos
    
    def _get_verb_type(self, pos_tags: List[str]) -> Optional[Dict]:
        """获取动词类型"""
        if len(pos_tags) < 2 or pos_tags[0] != '動詞':
            return None
        
        transitivity = pos_tags[1] if len(pos_tags) > 1 else ''
        conjugation = pos_tags[4] if len(pos_tags) > 4 else ''
        
        verb_info = {
            'transitivity': transitivity,
            'conjugation_type': conjugation
        }
        
        if '五段' in conjugation:
            verb_info['class'] = '五段动词（一类动词）'
        elif '一段' in conjugation:
            verb_info['class'] = '一段动词（二类动词）'
        elif 'サ行変格' in conjugation:
            verb_info['class'] = 'サ变动词'
        elif 'カ行変格' in conjugation:
            verb_info['class'] = 'カ变动词'
        else:
            verb_info['class'] = conjugation
        
        return verb_info
    
    def _get_verb_form(self, pos_tags: List[str]) -> Optional[str]:
        """获取动词形式"""
        if len(pos_tags) < 6 or pos_tags[0] != '動詞':
            return None
        
        return pos_tags[5] if len(pos_tags) > 5 else '終止形-一般'
    
    def _lookup_dict(self, word: str) -> Optional[List]:
        """查询 Jamdict 词典"""
        try:
            result = self.jamdict.lookup(word)
            entries = []
            
            for entry in result.entries:
                meanings = []
                
                for sense in entry.senses:
                    gloss_list = []
                    for gloss in sense.gloss:
                        gloss_list.append(str(gloss))
                    
                    meanings.append({
                        'pos': ', '.join([str(p) for p in sense.pos]),
                        'meanings': gloss_list
                    })
                
                readings = []
                for kana in entry.kana_forms:
                    readings.append(str(kana))
                
                entries.append({
                    'kanji': str(entry.kanji_forms[0]) if entry.kanji_forms else word,
                    'readings': readings,
                    'meanings': meanings
                })
            
            return entries if entries else None
            
        except Exception as e:
            return None
    
    def _build_unified_result(self, word: str, morphology: Optional[Dict], dict_results: Optional[List]) -> Dict:
        """构建统一格式的结果"""
        translation = self._build_translation(dict_results)
        vocabulary = self._build_vocabulary(word, morphology, dict_results)
        grammar_points = []
        special_notes = self._build_special_notes(morphology, dict_results)
        
        return {
            "translation": translation,
            "grammar_points": grammar_points,
            "vocabulary": vocabulary,
            "special_notes": special_notes
        }
    
    def _build_translation(self, dict_results: Optional[List]) -> str:
        """构建翻译"""
        if not dict_results:
            return "（词典中未找到该词）"
        
        first_entry = dict_results[0]
        if first_entry['meanings']:
            first_meanings = first_entry['meanings'][0]['meanings']
            return '、'.join(first_meanings[:3])
        
        return "（无释义）"
    
    def _build_vocabulary(self, word: str, morphology: Optional[Dict], dict_results: Optional[List]) -> List[Dict]:
        """构建词汇列表"""
        vocab_list = []
        
        main_vocab = {
            "word": word,
            "reading": "",
            "meaning": "",
            "level": "N2",
            "conjugation": {
                "has_conjugation": False
            }
        }
        
        if morphology:
            surface = morphology.get('surface', '')
            dictionary_form = morphology.get('dictionary_form', '')
            surface_reading = morphology.get('surface_reading', '')

            if surface_reading:
                main_vocab["reading"] = surface_reading
            else:
                # 才使用 fallback mapping
                dictionary_reading = morphology.get('dictionary_reading', '')
                main_vocab["reading"] = self._generate_complete_reading(
                    surface, dictionary_form, dictionary_reading
                )
            
            if morphology.get('pos_type') == 'verb':
                verb_type = morphology.get('verb_type')
                if verb_type and isinstance(verb_type, dict):
                    main_vocab["conjugation"] = self._build_verb_conjugation(morphology)
        
        if dict_results:
            first_entry = dict_results[0]
            
            if not main_vocab["reading"] and first_entry['readings']:
                main_vocab["reading"] = first_entry['readings'][0]
            
            if first_entry['meanings']:
                meanings_list = first_entry['meanings'][0]['meanings']
                main_vocab["meaning"] = '；'.join(meanings_list[:2])
        
        vocab_list.append(main_vocab)
        return vocab_list
    
    def _detect_verb_form_by_ending(self, surface: str, dictionary_form: str, pos_tags: List[str]) -> Optional[str]:
        """
        高精度动词变形判断（最终版）
        surface: 实际看到的形（驚かされた、食べられる等）
        dictionary_form: 原型（驚かす、食べる等）
        pos_tags: Sudachi 给的词性列表
        """

        # —— 1. 使役被动形（させられる 系）——
        if surface.endswith("させられた"):
            return "使役被动形-过去"
        if surface.endswith("させられて"):
            return "使役被动形-て形"
        if surface.endswith("させられる"):
            return "使役被动形"

        # —— 2. 纯使役形（させる 系）——
        if surface.endswith("させた"):
            return "使役形-过去"
        if surface.endswith("させて"):
            return "使役形-て形"
        if surface.endswith("させる"):
            return "使役形"

        # —— 3. られる：可能 or 被动 —— 
        if surface.endswith("られた"):
            return "被动形-过去"
        if surface.endswith("られて"):
            return "被动形-て形"
        if surface.endswith("られる"):
            # 如果是典型一段动词，优先判为可能形
            if self._is_ichidan(dictionary_form):
                return "可能形"
            return "被动形"

        # —— 4. 枯れる / 見える 等「本来就以 れる 结尾的一段动词」——
        if surface == dictionary_form and dictionary_form.endswith("れる"):
            if self._is_ichidan(dictionary_form):
                return "原型（一段动词）"

        # —— 5. 一般被动形（受身形）——
        if surface.endswith("れた"):
            return "被动形-过去"
        if surface.endswith("れて"):
            return "被动形-て形"
        if surface.endswith("れる"):
            return "被动形"

        # —— 6. 否定形 —— 
        if surface.endswith("なかった"):
            return "否定形-过去"
        if surface.endswith("なくて"):
            return "否定形-て形"
        if surface.endswith("ない"):
            return "否定形"

        # —— 7. 敬体 ——  
        if surface.endswith("ませんでした"):
            return "否定形-过去"
        if surface.endswith("ました"):
            return "敬体过去形"
        if surface.endswith("ます"):
            return "敬体形"

        return None

    def _is_ichidan(self, dictionary_form: str) -> bool:
        """
        判断是否为一段动词（非常可靠）
        一段动词规律：假名词干 + る（前一个平假名是 い段 或 え段）
        例：食べる、見る、寝る、枯れる
        """
        if not dictionary_form.endswith("る"):
            return False

        if len(dictionary_form) < 2:
            return False

        prev_char = dictionary_form[-2]

        # 平假名的「い段 + え段」
        i_e_dan = "いきしちにひみりえけせてねへめれ"
        return prev_char in i_e_dan
    
    def _build_verb_conjugation(self, morphology: Dict) -> Dict:
        """构建动词活用信息"""
        verb_type_info = morphology.get('verb_type', {})

        if not verb_type_info or not isinstance(verb_type_info, dict):
            return {"has_conjugation": False}

        dictionary_form = morphology.get('dictionary_form', '')
        surface_form = morphology.get('surface', '')
        pos_tags = morphology.get('pos') or []
        current_form = morphology.get('verb_form', '終止形-一般')

        # ✅ 使用新的 3 参数版本结尾判断函数
        detected_form = self._detect_verb_form_by_ending(
            surface_form,
            dictionary_form,
            pos_tags,
        )
        if detected_form:
            current_form = detected_form

        conjugation = {
            "has_conjugation": True,
            "original_form": f"{dictionary_form}（{verb_type_info.get('class', '动词')}）",
            "current_form": surface_form,
            "conjugation_type": self._translate_verb_form(current_form),
            "reason": self._explain_verb_form(current_form),
            "verb_class": verb_type_info.get('class', ''),
            "transitivity": self._translate_transitivity(verb_type_info.get('transitivity', ''))
        }

        # 生成所有活用形（如果你已经有 verb_conjugator 就会用上，没有也不会崩）
        try:
            from app.services.verb_conjugator import get_verb_conjugator
            conjugator = get_verb_conjugator()
            all_forms = conjugator.conjugate(dictionary_form, verb_type_info.get('class', ''))
            conjugation['all_forms'] = all_forms
        except Exception:
            pass

        return conjugation
    
    def _translate_verb_form(self, form: str) -> str:
        """翻译动词形式名称"""
        form_map = {
            '終止形-一般': '原型（辞书形）',
            '連用形-一般': '连用形',
            '連用形-促音便': 'た形（过去形）',
            '仮定形-一般': '假定形（ば形）',
            '命令形': '命令形',
            '未然形-一般': '未然形',
            '連体形-一般': '连体形',
            '被动形': '被动形（受身形）',
            '被动形-过去': '被动形的过去式',
            '被动形-て形': '被动形的て形',
            '使役形': '使役形',
            '使役形-过去': '使役形的过去式',
            '使役形-て形': '使役形的て形',
            '否定形': '否定形（ない形）',
            '否定形-过去': '否定形的过去式',
            '否定形-て形': '否定形的て形',
        }
        return form_map.get(form, form)
    
    def _explain_verb_form(self, form: str) -> str:
        """解释动词形式的用法"""
        explanations = {
            '終止形-一般': '原型，用于结句或作为辞书形',
            '連用形-一般': '用于连接其他动词或助词',
            '連用形-促音便': '过去形（た形），表示动作已完成',
            '仮定形-一般': '假定形，用于表达假设条件',
            '命令形': '命令形，用于表达命令或指示',
            '未然形-一般': '未然形，用于接续否定助词ない等',
            '連体形-一般': '连体形，用于修饰名词',
            '被动形': '被动形，表示被动语态',
            '被动形-过去': '被动形的过去式',
            '被动形-て形': '被动形的て形',
            '使役形': '使役形，表示让/使某人做某事',
            '使役形-过去': '使役形的过去式',
            '使役形-て形': '使役形的て形',
            '否定形': '否定形，表示否定',
            '否定形-过去': '否定形的过去式',
            '否定形-て形': '否定形的て形',
        }
        return explanations.get(form, '具体用法请参考语法书')
    
    def _translate_transitivity(self, transitivity: str) -> str:
        """翻译自他动词"""
        if '自立' in transitivity:
            return '自动词'
        elif transitivity == '':
            return ''
        return transitivity
    
    def _build_special_notes(self, morphology: Optional[Dict], dict_results: Optional[List]) -> List[str]:
        """构建特殊说明"""
        notes = []
        
        if not dict_results:
            notes.append("⚠️ 词典中未找到该词")
            notes.append("💡 可能是：1) 变形词 2) 专有名词 3) 较新的词汇")
        
        return notes


# 全局单例
_parser_instance = None

def get_japanese_parser():
    """获取日语解析器单例"""
    global _parser_instance
    if _parser_instance is None:
        _parser_instance = JapaneseWordParser()
    return _parser_instance