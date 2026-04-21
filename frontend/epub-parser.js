/**
 * epub-parser.js — EPUB 内容抽取与结构化
 *
 * 职责：将 epub.js book 对象的章节 HTML 转换为
 * 与排版完全无关的结构化数据，供 renderer.js 使用。
 *
 * 输出数据格式：
 *   Chapter  = { id, href, blocks: Block[] }
 *   Block    = ParagraphBlock | HeadingBlock | BreakBlock
 *   Node     = TextNode | RubyNode | BreakNode
 */

// ─── 公共 API ─────────────────────────────────────────────────────────────────

/**
 * 从 epub.js book 对象构建章节索引表（不加载内容，只读元数据）。
 * @param {object} book - epub.js Book
 * @returns {{ index, id, href, title }[]}
 */
async function buildChapterList(book) {
  // 展平 TOC，以去锚点 href 为键
  const tocMap = new Map();
  function flattenToc(items) {
    for (const item of items) {
      const href = (item.href || '').split('#')[0];
      if (href && !tocMap.has(href)) tocMap.set(href, item.label || '');
      if (item.subitems?.length) flattenToc(item.subitems);
    }
  }
  flattenToc(book.navigation?.toc || []);

  return book.spine.items.map((item, index) => ({
    index,
    id   : item.idref,
    href : item.href,
    title: tocMap.get((item.href || '').split('#')[0]) || null,
  }));
}

/**
 * 加载并解析单章节，返回结构化块数组。
 * @param {object} epubBook  - epub.js Book
 * @param {object} spineItem - book.spine.items[i]（Section 对象）
 * @returns {Promise<Chapter>}
 */
async function loadChapter(epubBook, spineItem) {
  const doc = await _fetchChapterDoc(epubBook, spineItem);
  const blocks = _parseBody(doc.body);

  try { spineItem.unload(); } catch {} // 解析完立即释放内存

  return {
    id    : spineItem.idref,
    href  : spineItem.href,
    blocks,
  };
}

// ─── 章节 HTML 获取（多路径容错）────────────────────────────────────────────────

async function _fetchChapterDoc(epubBook, spineItem) {
  // 方案 A：epub.js Section.load() 标准 API
  try {
    await spineItem.load(epubBook.load.bind(epubBook));
    if (spineItem.document) return spineItem.document;
  } catch (e) {
    console.warn('[epub-parser] Section.load() 失败，尝试备用方案:', e.message);
  }

  // 方案 B：直接通过 book.load 加载原始 HTML
  try {
    const raw = await epubBook.load(spineItem.href);
    const html = typeof raw === 'string'           ? raw
               : raw instanceof Document           ? raw.documentElement.outerHTML
               : raw instanceof Blob               ? await raw.text()
               : '';
    return new DOMParser().parseFromString(html || '<body></body>', 'text/html');
  } catch (e) {
    console.warn('[epub-parser] book.load() 也失败:', e.message);
  }

  return new DOMParser().parseFromString('<body></body>', 'text/html');
}

// ─── HTML → 块数组 ────────────────────────────────────────────────────────────

// 被视为"块级容器"的标签（内部内容平铺为段落）
const BLOCK_TAGS = new Set([
  'p', 'div', 'section', 'article', 'blockquote',
  'figure', 'figcaption', 'header', 'footer', 'aside',
  'li', 'td', 'th', 'caption',
]);
const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
// 直接丢弃的标签（样式/脚本/媒体）
const SKIP_TAGS   = new Set([
  'script', 'style', 'noscript', 'head', 'meta',
  'link', 'img', 'picture', 'video', 'audio', 'svg',
]);

function _parseBody(bodyEl) {
  const blocks = [];
  _collectBlocks(bodyEl, blocks);
  return blocks.filter(b => !_isEmpty(b));
}

function _collectBlocks(node, blocks) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent.trim();
      if (text) blocks.push({ type: 'paragraph', nodes: [{ type: 'text', content: text }] });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;

    if (HEADING_TAGS.has(tag)) {
      const nodes = _collectInline(child);
      if (nodes.length) blocks.push({ type: 'heading', level: parseInt(tag[1], 10), nodes });

    } else if (BLOCK_TAGS.has(tag)) {
      // 若块内还有子块容器，递归拆分；否则整体作为一段
      const hasChildBlock = [...child.children].some(c =>
        BLOCK_TAGS.has(c.tagName.toLowerCase()) ||
        HEADING_TAGS.has(c.tagName.toLowerCase())
      );
      if (hasChildBlock) {
        _collectBlocks(child, blocks);
      } else {
        const nodes = _collectInline(child);
        if (nodes.length) blocks.push({ type: 'paragraph', nodes });
      }

    } else if (tag === 'br') {
      blocks.push({ type: 'break' });

    } else {
      // span / a / em 等内联容器 → 继续向下找块
      _collectBlocks(child, blocks);
    }
  }
}

// ─── 行内节点提取 ─────────────────────────────────────────────────────────────

function _collectInline(el) {
  const nodes = [];
  _walkInline(el, nodes);
  return _mergeText(nodes);
}

function _walkInline(node, nodes) {
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent;
      if (text) nodes.push({ type: 'text', content: text });
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) continue;

    if (tag === 'ruby') {
      const ruby = _extractRuby(child);
      if (ruby) nodes.push(ruby);
    } else if (tag === 'br') {
      nodes.push({ type: 'break' });
    } else if (tag === 'rt' || tag === 'rp') {
      // 孤立 rt/rp（不在 ruby 内），跳过
    } else {
      _walkInline(child, nodes); // 递归处理内联容器
    }
  }
}

// ─── Ruby 提取 ────────────────────────────────────────────────────────────────
// 支持：
//   <ruby>東京<rt>とうきょう</rt></ruby>
//   <ruby><rb>東</rb><rt>とう</rt><rb>京</rb><rt>きょう</rt></ruby>
//   混合形式（文本节点 + rb/rt 交替）

function _extractRuby(rubyEl) {
  const pairs = [];
  let currentBase = '';

  for (const child of rubyEl.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      currentBase += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'rb') {
        currentBase += child.textContent;
      } else if (tag === 'rt') {
        pairs.push({ base: currentBase, reading: child.textContent });
        currentBase = '';
      } else if (tag === 'rp') {
        // 忽略括号
      } else {
        currentBase += child.textContent; // 其他嵌套标签当纯文本
      }
    }
  }

  // 处理末尾没有对应 rt 的文字（如 <ruby>A<rt>a</rt>B</ruby>）
  if (currentBase.trim()) {
    pairs.push({ base: currentBase, reading: '' });
  }

  if (!pairs.length) return null;

  return {
    type   : 'ruby',
    base   : pairs.map(p => p.base).join(''),    // 完整基础文字（用于搜索/复制）
    reading: pairs.map(p => p.reading).join(''), // 完整注音（用于单 ruby 渲染）
    pairs,                                        // 细粒度对（用于多段 ruby 渲染）
  };
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

// 合并相邻文字节点
function _mergeText(nodes) {
  return nodes.reduce((acc, node) => {
    const prev = acc[acc.length - 1];
    if (node.type === 'text' && prev?.type === 'text') {
      prev.content += node.content;
    } else {
      acc.push(node);
    }
    return acc;
  }, []);
}

// 判断块是否为空（无实质内容）
function _isEmpty(block) {
  if (block.type === 'break') return false;
  return !block.nodes?.some(n =>
    n.type === 'break' ||
    (n.content ?? n.base ?? '').trim() !== ''
  );
}
