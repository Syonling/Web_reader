/**
 * api.js — 所有后端 API 调用
 * 每个方法对应一个后端端点，统一处理错误。
 * 未来换后端或部署时只需修改此文件。
 */
const API = {

  /** 检查后端健康状态 */
  async checkHealth() {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /** 获取所有可用 AI 提供商列表及当前选择 */
  async getProviders() {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/providers`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /**
   * 切换 AI 提供商
   * @param {string} provider - 提供商 ID，如 'deepseek' | 'openai' | 'claude' 等
   */
  async switchProvider(provider) {
    const res = await fetch(`${CONFIG.API_BASE_URL}/api/switch-provider`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },

  /**
   * 分析选中文本
   * @param {string} text - 要分析的文字或句子
   * @param {string|null} forceType - 强制类型：'word' | 'sentence' | null（自动判断）
   */
  async analyzeText(text, forceType = null) {
    const body = { text };
    if (forceType) body.force_type = forceType;

    const res = await fetch(`${CONFIG.API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    return res.json();
  },
};
