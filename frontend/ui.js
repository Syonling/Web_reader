/**
 * ui.js — 所有 UI 组件的操作
 * 包括：弹窗、加载状态、分析结果渲染、浮动按钮、状态栏。
 * 与业务逻辑解耦：只操作 DOM，不直接调用 API。
 */
const UI = {

  // ─── 弹窗 ────────────────────────────────────────────────────────────────

  /** 显示"分析中"加载状态 */
  showLoading(text) {
    this._setModalTitle('分析中...');
    this._setModalBody(`
      <div class="loading-state">
        <div class="spinner"></div>
        <p class="loading-text">正在分析：<em class="selected-preview">${escapeHtml(text)}</em></p>
      </div>
    `);
    this._openModal();
  },

  /** 显示分析结果 */
  showResult(data) {
    this._setModalTitle('分析结果');
    const result = parseAnalysisResult(data.analysis.result);
    this._setModalBody(renderAnalysis(result, data.original_text));
    this._openModal();
  },

  /** 显示错误信息 */
  showError(message) {
    this._setModalTitle('出错了');
    this._setModalBody(`
      <div class="error-state">
        <p class="error-icon">⚠️</p>
        <p class="error-message">${escapeHtml(message)}</p>
      </div>
    `);
    this._openModal();
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  },

  _openModal() {
    document.getElementById('modal-overlay').classList.remove('hidden');
  },

  _setModalTitle(title) {
    document.getElementById('modal-title').textContent = title;
  },

  _setModalBody(html) {
    document.getElementById('modal-body').innerHTML = html;
  },

  // ─── 工具栏分析按钮 ───────────────────────────────────────────────────────
  // 选中文字时启用，清除选区或翻页后禁用。

  setAnalyzeBtnEnabled(enabled) {
    const btn = document.getElementById('analyze-btn');
    btn.disabled = !enabled;
  },

  // ─── 工具栏 ───────────────────────────────────────────────────────────────

  /** 用后端返回的提供商列表填充下拉菜单 */
  populateProviders(providers, current) {
    const select = document.getElementById('provider-select');
    select.innerHTML = providers.map(p => {
      const needsKey = p.status === 'needs_key';
      return `<option value="${p.id}" ${p.id === current ? 'selected' : ''} ${needsKey ? 'class="needs-key"' : ''}>
        ${escapeHtml(p.display_name)}${needsKey ? ' ⚠' : ''}
      </option>`;
    }).join('');
    select.disabled = false;
  },

  setBookTitle(title) {
    document.getElementById('book-title').textContent = title;
  },

  showNavigation() {
    document.getElementById('navigation').hidden = false;
  },

  setStatus(online) {
    const dot = document.getElementById('status-dot');
    const text = document.getElementById('status-text');
    dot.className = `status-dot ${online ? 'status-online' : 'status-offline'}`;
    dot.title = online ? '后端已连接' : '后端未连接';
    if (text) text.textContent = online ? '后端已连接' : '后端未连接';
  },

  /** 更新工具栏的字体大小数字显示 */
  updateFontSizeLabel(size) {
    document.getElementById('font-size-label').textContent = `${size}%`;
  },
};

// ─── 分析结果渲染 ─────────────────────────────────────────────────────────────

/**
 * 后端返回的 result 字段可能是 JSON 字符串（句子分析）或对象（单词分析）。
 * 统一解析为对象。
 */
function parseAnalysisResult(raw) {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return { translation: raw };
    }
  }
  return raw || {};
}

/** 将分析结果渲染为 HTML 字符串 */
function renderAnalysis(result, originalText) {
  const sections = [];

  sections.push(`
    <div class="result-section">
      <h4 class="section-title">原文</h4>
      <p class="original-text">${escapeHtml(originalText)}</p>
    </div>`);

  if (result.translation) {
    sections.push(`
      <div class="result-section">
        <h4 class="section-title">翻译</h4>
        <p class="translation-text">${escapeHtml(result.translation)}</p>
      </div>`);
  }

  if (result.vocabulary?.length) {
    const items = result.vocabulary.map(v => {
      const conj = v.conjugation?.has_conjugation
        ? `<div class="conjugation-note">${escapeHtml(v.conjugation.conjugation_type || '')}${v.conjugation.reason ? ' — ' + escapeHtml(v.conjugation.reason) : ''}</div>`
        : '';
      return `
        <li class="vocab-item">
          <span class="vocab-word">${escapeHtml(v.word)}</span>
          ${v.reading ? `<span class="vocab-reading">（${escapeHtml(v.reading)}）</span>` : ''}
          ${v.level ? `<span class="level-badge">${escapeHtml(v.level)}</span>` : ''}
          <span class="vocab-meaning">${escapeHtml(v.meaning)}</span>
          ${conj}
        </li>`;
    }).join('');
    sections.push(`
      <div class="result-section">
        <h4 class="section-title">词汇</h4>
        <ul class="vocab-list">${items}</ul>
      </div>`);
  }

  if (result.grammar_points?.length) {
    const items = result.grammar_points.map(g => `
      <li class="grammar-item">
        <div class="grammar-header">
          <span class="grammar-pattern">${escapeHtml(g.pattern)}</span>
          ${g.level ? `<span class="level-badge">${escapeHtml(g.level)}</span>` : ''}
        </div>
        <p class="grammar-explanation">${escapeHtml(g.explanation)}</p>
        ${g.example_in_sentence ? `<p class="grammar-example">例：${escapeHtml(g.example_in_sentence)}</p>` : ''}
      </li>`).join('');
    sections.push(`
      <div class="result-section">
        <h4 class="section-title">语法点</h4>
        <ul class="grammar-list">${items}</ul>
      </div>`);
  }

  if (result.special_notes?.length) {
    const items = result.special_notes.map(n => `<li>${escapeHtml(n)}</li>`).join('');
    sections.push(`
      <div class="result-section">
        <h4 class="section-title">备注</h4>
        <ul class="notes-list">${items}</ul>
      </div>`);
  }

  return sections.join('');
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── 弹窗事件绑定 ─────────────────────────────────────────────────────────────

document.getElementById('modal-close').addEventListener('click', () => UI.closeModal());

// 点击遮罩层关闭弹窗
document.getElementById('modal-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'modal-overlay') UI.closeModal();
});

// ESC 键关闭弹窗
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') UI.closeModal();
});
