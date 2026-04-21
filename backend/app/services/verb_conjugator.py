"""
日语动词变形生成器
支持五段、一段、サ变、カ变动词的完整变形
"""


class JapaneseVerbConjugator:
    """日语动词变形器"""
    
    def conjugate(self, verb: str, verb_type: str) -> dict:
        """
        生成动词的所有变形
        
        Args:
            verb: 动词原型（辞书形）
            verb_type: 动词类型（五段、一段、サ变、カ变）
        
        Returns:
            包含所有变形的字典
        """
        if '五段' in verb_type:
            return self._conjugate_godan(verb, verb_type)
        elif '一段' in verb_type:
            if '上一段' in verb_type or '下一段' in verb_type:
                return self._conjugate_ichidan(verb)
            return self._conjugate_ichidan(verb)
        elif 'サ行変格' in verb_type:
            return self._conjugate_suru(verb)
        elif 'カ行変格' in verb_type:
            return self._conjugate_kuru(verb)
        else:
            return self._conjugate_default(verb)
    
    def _conjugate_godan(self, verb: str, verb_type: str) -> dict:
        """五段动词变形"""
        # 获取词干和词尾
        stem = verb[:-1]
        ending = verb[-1]
        
        # 根据行确定变形
        godan_map = {
            'う': {'a': 'わ', 'i': 'い', 'u': 'う', 'e': 'え', 'o': 'お'},
            'く': {'a': 'か', 'i': 'き', 'u': 'く', 'e': 'け', 'o': 'こ'},
            'ぐ': {'a': 'が', 'i': 'ぎ', 'u': 'ぐ', 'e': 'げ', 'o': 'ご'},
            'す': {'a': 'さ', 'i': 'し', 'u': 'す', 'e': 'せ', 'o': 'そ'},
            'つ': {'a': 'た', 'i': 'ち', 'u': 'つ', 'e': 'て', 'o': 'と'},
            'ぬ': {'a': 'な', 'i': 'に', 'u': 'ぬ', 'e': 'ね', 'o': 'の'},
            'ぶ': {'a': 'ば', 'i': 'び', 'u': 'ぶ', 'e': 'べ', 'o': 'ぼ'},
            'む': {'a': 'ま', 'i': 'み', 'u': 'む', 'e': 'め', 'o': 'も'},
            'る': {'a': 'ら', 'i': 'り', 'u': 'る', 'e': 'れ', 'o': 'ろ'},
        }
        
        changes = godan_map.get(ending, godan_map['る'])
        
        # 促音便规则（て形、た形）
        te_ta_rules = {
            'く': ('いて', 'いた'),  # 書く → 書いて
            'ぐ': ('いで', 'いだ'),  # 泳ぐ → 泳いで
            'す': ('して', 'した'),  # 話す → 話して
            'う': ('って', 'った'),  # 買う → 買って
            'つ': ('って', 'った'),  # 待つ → 待って
            'る': ('って', 'った'),  # 帰る → 帰って
            'ぬ': ('んで', 'んだ'),  # 死ぬ → 死んで
            'ぶ': ('んで', 'んだ'),  # 遊ぶ → 遊んで
            'む': ('んで', 'んだ'),  # 読む → 読んで
        }
        
        te_ending, ta_ending = te_ta_rules.get(ending, ('って', 'った'))
        
        return {
            'dictionary_form': verb,
            'masu_form': stem + changes['i'] + 'ます',
            'te_form': stem + te_ending,
            'ta_form': stem + ta_ending,
            'nai_form': stem + changes['a'] + 'ない',
            'nakatta_form': stem + changes['a'] + 'なかった',
            'ba_form': stem + changes['e'] + 'ば',
            'command_form': stem + changes['e'],
            'volitional_form': stem + changes['o'] + 'う',
            'passive_form': stem + changes['a'] + 'れる',
            'causative_form': stem + changes['a'] + 'せる',
            'potential_form': stem + changes['e'] + 'る',
            'causative_passive_form': stem + changes['a'] + 'せられる',
        }
    
    def _conjugate_ichidan(self, verb: str) -> dict:
        """一段动词变形"""
        stem = verb[:-1]  # 去掉る
        
        return {
            'dictionary_form': verb,
            'masu_form': stem + 'ます',
            'te_form': stem + 'て',
            'ta_form': stem + 'た',
            'nai_form': stem + 'ない',
            'nakatta_form': stem + 'なかった',
            'ba_form': stem + 'れば',
            'command_form': stem + 'ろ',  # 或 stem + 'よ'
            'volitional_form': stem + 'よう',
            'passive_form': stem + 'られる',
            'causative_form': stem + 'させる',
            'potential_form': stem + 'られる',  # 与被动形相同
            'causative_passive_form': stem + 'させられる',
        }
    
    def _conjugate_suru(self, verb: str) -> dict:
        """サ变动词变形（する）"""
        if verb == 'する':
            stem = ''
        else:
            stem = verb[:-2]  # 去掉する
        
        return {
            'dictionary_form': verb,
            'masu_form': stem + 'します',
            'te_form': stem + 'して',
            'ta_form': stem + 'した',
            'nai_form': stem + 'しない',
            'nakatta_form': stem + 'しなかった',
            'ba_form': stem + 'すれば',
            'command_form': stem + 'しろ',  # 或 stem + 'せよ'
            'volitional_form': stem + 'しよう',
            'passive_form': stem + 'される',
            'causative_form': stem + 'させる',
            'potential_form': stem + 'できる',
            'causative_passive_form': stem + 'させられる',
        }
    
    def _conjugate_kuru(self, verb: str) -> dict:
        """カ变动词变形（来る）"""
        return {
            'dictionary_form': '来る（くる）',
            'masu_form': '来ます（きます）',
            'te_form': '来て（きて）',
            'ta_form': '来た（きた）',
            'nai_form': '来ない（こない）',
            'nakatta_form': '来なかった（こなかった）',
            'ba_form': '来れば（くれば）',
            'command_form': '来い（こい）',
            'volitional_form': '来よう（こよう）',
            'passive_form': '来られる（こられる）',
            'causative_form': '来させる（こさせる）',
            'potential_form': '来られる（こられる）',
            'causative_passive_form': '来させられる（こさせられる）',
        }
    
    def _conjugate_default(self, verb: str) -> dict:
        """默认变形（未识别类型）"""
        return {
            'dictionary_form': verb,
            'masu_form': '（需要指定动词类型）',
            'te_form': '（需要指定动词类型）',
            'ta_form': '（需要指定动词类型）',
            'nai_form': '（需要指定动词类型）',
        }
    
    def get_conjugation_explanations(self) -> dict:
        """获取各变形的中文解释"""
        return {
            'dictionary_form': '辞书形（原型）',
            'masu_form': 'ます形（礼貌形）',
            'te_form': 'て形（连接形）',
            'ta_form': 'た形（过去形）',
            'nai_form': 'ない形（否定形）',
            'nakatta_form': 'なかった形（过去否定形）',
            'ba_form': 'ば形（假定形）',
            'command_form': '命令形',
            'volitional_form': '意志形（よう形）',
            'passive_form': '受身形（被动形）',
            'causative_form': '使役形',
            'potential_form': '可能形',
            'causative_passive_form': '使役受身形',
        }


# 全局单例
_conjugator_instance = None


def get_verb_conjugator():
    """获取动词变形器单例"""
    global _conjugator_instance
    if _conjugator_instance is None:
        _conjugator_instance = JapaneseVerbConjugator()
    return _conjugator_instance