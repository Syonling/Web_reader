/**
 * renderer.js — 结构化内容 → DOM
 *
 * 将 epub-parser.js 输出的 Chapter 对象渲染为真实 DOM。
 * 不注入任何内联样式，排版由外部 CSS 完全控制。
 */

const Renderer = {
  /**
   * 将章节内容渲染到指定容器。
   * @param {object} chapter  - epub-parser.js 返回的 Chapter
   * @param {HTMLElement} container - 挂载目标（内容追加，不清空）
   */
  render(chapter, container) {
    const frag = document.createDocumentFragment();
    for (const block of chapter.blocks) {
      const el = this._renderBlock(block);
      if (el) frag.appendChild(el);
    }
    container.appendChild(frag);
  },

  _renderBlock(block) {
    if (block.type === 'break') {
      return document.createElement('br');
    }
    if (block.type === 'heading') {
      const level = Math.min(6, Math.max(1, block.level || 1));
      const el = document.createElement(`h${level}`);
      el.className = `r-h r-h${level}`;
      this._appendNodes(el, block.nodes);
      return el;
    }
    if (block.type === 'paragraph') {
      const el = document.createElement('p');
      el.className = 'r-p';
      this._appendNodes(el, block.nodes);
      return el;
    }
    return null;
  },

  _appendNodes(parent, nodes) {
    if (!nodes) return;
    for (const node of nodes) {
      const child = this._renderNode(node);
      if (child) parent.appendChild(child);
    }
  },

  _renderNode(node) {
    if (node.type === 'text') {
      return document.createTextNode(node.content);
    }
    if (node.type === 'break') {
      return document.createElement('br');
    }
    if (node.type === 'ruby') {
      return this._renderRuby(node);
    }
    return null;
  },

  _renderRuby(node) {
    const ruby = document.createElement('ruby');

    if (node.pairs && node.pairs.length > 1) {
      // 多段 ruby：<ruby><rb>基</rb><rt>き</rt><rb>礎</rb><rt>そ</rt></ruby>
      for (const pair of node.pairs) {
        if (pair.base) {
          const rb = document.createElement('rb');
          rb.textContent = pair.base;
          ruby.appendChild(rb);
        }
        const rt = document.createElement('rt');
        rt.textContent = pair.reading || '';
        ruby.appendChild(rt);
      }
    } else {
      // 单段 ruby：<ruby>東京<rt>とうきょう</rt></ruby>
      ruby.appendChild(document.createTextNode(node.base || ''));
      const rt = document.createElement('rt');
      rt.textContent = node.reading || '';
      ruby.appendChild(rt);
    }

    return ruby;
  },
};
