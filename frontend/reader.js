/**
 * reader.js — 多格式文件加载、渲染与文字选取
 *
 * 支持格式：
 *   EPUB  → epub-parser.js 内容抽取 + renderer.js 自控排版
 *   PDF   → PDF.js 渲染（canvas + 文字层）
 *   TXT   → 纯文本显示
 *   其他  → 提示不支持，建议用 Calibre 转换
 *
 * 依赖：epub.js（仅解析）、PDF.js、config.js、api.js、ui.js、epub-parser.js、renderer.js
 */

// ─── 全局状态 ─────────────────────────────────────────────────────────────────

let readerType   = null;   // 'epub' | 'pdf' | 'txt'
let selectedText = '';
let currentFontSize = CONFIG.READER.FONT_SIZE_DEFAULT;

// EPUB 专用
let epubBook         = null;
let epubChapterList  = [];        // { index, id, href, title }[]
let epubCurrentIndex = 0;
let epubCurrentChapter = null;
let epubDirection    = 'horizontal'; // 'horizontal' | 'vertical'
let epubTocOpen      = false;
let epubPageNum      = 0;            // 当前章节内页码（0-based）
let epubTotalPages   = 1;            // 当前章节总页数
let epubPageStep     = 1;            // EPUB 每页水平推进距离（px）
let epubVerticalScrollSign = -1;     // vertical-rl 下一页的 scrollLeft 方向
let epubResizeTimer  = null;
const chapterCache   = new Map();    // index → Chapter

// PDF 专用
let pdfDoc          = null;
let currentPdfPage  = 1;
let currentPdfScale = 1.5;

// ─── ReaderProgress（存档接口，保留供后端书架/进度功能扩展）────────────────────

const ReaderProgress = {
  save(bookId, index) { /* TODO: POST /api/progress */ },
  load(bookId)        { return null; /* TODO: GET /api/progress/:id */ },
};

// ─── 文件打开入口 ─────────────────────────────────────────────────────────────

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  e.target.value = '';
  await loadFile(file);
});

async function loadFile(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  cleanupCurrentReader();

  if (ext === 'epub') {
    await loadEpub(file);
  } else if (ext === 'pdf') {
    await loadPdf(file);
  } else if (ext === 'txt') {
    await loadTxt(file);
  } else if (['mobi', 'azw3', 'azw', 'kfx'].includes(ext)) {
    showUnsupportedFormat(ext);
  } else {
    showUnsupportedFormat(ext);
  }
}

// ─── 格式不支持提示 ───────────────────────────────────────────────────────────

function showUnsupportedFormat(ext) {
  const placeholder = document.getElementById('placeholder');
  placeholder.innerHTML = `
    <div class="unsupported-msg">
      <p class="unsupported-title">不支持 .${ext.toUpperCase()} 格式</p>
      <p class="unsupported-body">
        浏览器端无法直接解析 Kindle / 专有格式。<br>
        请先用 <strong>Calibre</strong> 将文件转换为 EPUB 或 PDF，再打开。
      </p>
    </div>
  `;
  placeholder.classList.remove('hidden');
  UI.setBookTitle(`不支持 .${ext}`);
}

// ─── 清理当前阅读器 ────────────────────────────────────────────────────────────

function cleanupCurrentReader() {
  // EPUB 清理
  if (epubBook) { try { epubBook.destroy(); } catch {} epubBook = null; }
  epubChapterList  = [];
  epubCurrentIndex = 0;
  epubCurrentChapter = null;
  epubPageNum      = 0;
  epubTotalPages   = 1;
  epubPageStep     = 1;
  epubVerticalScrollSign = -1;
  clearTimeout(epubResizeTimer);
  chapterCache.clear();
  epubTocOpen = false;
  document.getElementById('toc-panel').classList.add('hidden');
  document.getElementById('toc-btn').hidden = true;
  document.getElementById('toc-list').innerHTML = '';

  // PDF / TXT 清理
  if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
  document.removeEventListener('mouseup', onMainDocMouseUp);

  // 公共重置
  readerType      = null;
  selectedText    = '';
  currentFontSize = CONFIG.READER.FONT_SIZE_DEFAULT;
  currentPdfPage  = 1;
  currentPdfScale = 1.5;

  UI.updateFontSizeLabel(currentFontSize);
  UI.setAnalyzeBtnEnabled(false);

  const reader = document.getElementById('reader');
  reader.innerHTML = '';
  reader.removeAttribute('style');

  document.getElementById('navigation').hidden = true;
  document.getElementById('page-info').textContent = '';
  document.getElementById('direction-btn').hidden = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EPUB
// ═══════════════════════════════════════════════════════════════════════════════

async function loadEpub(file) {
  readerType = 'epub';
  UI.setBookTitle('加载中...');

  const arrayBuffer = await file.arrayBuffer();
  epubBook = ePub(arrayBuffer);
  await epubBook.ready;

  UI.setBookTitle(epubBook.packaging?.metadata?.title || file.name);
  document.getElementById('placeholder').classList.add('hidden');

  epubChapterList = await buildChapterList(epubBook);
  populateToc();

  // 构建阅读器 DOM 结构
  const container = document.getElementById('reader');
  container.innerHTML = '';
  container.removeAttribute('style');

  const epubEl = document.createElement('div');
  epubEl.id = 'epub-reader';
  epubEl.className = `epub-reader layout-${epubDirection}`;

  const scrollEl = document.createElement('div');
  scrollEl.id = 'epub-scroll';
  scrollEl.className = 'epub-scroll';

  const contentEl = document.createElement('div');
  contentEl.id = 'epub-content';
  contentEl.className = 'reader-content';
  contentEl.style.fontSize = currentFontSize + '%';

  scrollEl.appendChild(contentEl);
  epubEl.appendChild(scrollEl);
  container.appendChild(epubEl);

  epubEl.addEventListener('click', onEpubReaderClick);

  // 主文档选区监听
  document.addEventListener('mouseup', onMainDocMouseUp);

  // 显示控制按钮
  document.getElementById('toc-btn').hidden = false;
  document.getElementById('direction-btn').hidden = false;
  document.getElementById('direction-btn').textContent =
    epubDirection === 'horizontal' ? '竖排' : '横排';
  document.getElementById('prev-btn').textContent = '← 上一页';
  document.getElementById('next-btn').textContent = '下一页 →';
  UI.showNavigation();

  await renderEpubChapter(0);
}

async function renderEpubChapter(index) {
  if (index < 0 || index >= epubChapterList.length) return;
  epubCurrentIndex = index;

  const chapter   = await getEpubChapter(index);
  epubCurrentChapter = chapter;
  const contentEl = document.getElementById('epub-content');
  if (!contentEl) return;

  // 渲染前隐藏，避免短暂闪现错误位置的内容
  contentEl.style.cssText = 'opacity:0; font-size:' + currentFontSize + '%;';
  contentEl.innerHTML = '';

  // 布局初始化（设置容器尺寸 + 定位到第一页）
  initEpubLayout(true);

  updateEpubNav();
  updateTocHighlight(index);

  // 后台预取下一章
  const next = index + 1;
  if (next < epubChapterList.length && !chapterCache.has(next)) {
    getEpubChapter(next).catch(() => {});
  }

  ReaderProgress.save(epubBook?.packaging?.metadata?.identifier, index);
}

async function getEpubChapter(index) {
  if (chapterCache.has(index)) return chapterCache.get(index);
  const spineItem = epubBook.spine.items[index];
  const chapter   = await loadChapter(epubBook, spineItem);
  chapterCache.set(index, chapter);
  return chapter;
}

// ─── Kindle 风格 EPUB 分页 ───────────────────────────────────────────────────
//
// 横排保留 CSS columns；竖排重构为固定页容器，每页内部 vertical-rl。
// 这样竖排页数不再依赖浏览器对 writing-mode + columns 的 scrollWidth 解释。

function initEpubLayout(resetToStart = true) {
  requestAnimationFrame(() => {
    const scrollEl  = document.getElementById('epub-scroll');
    const contentEl = document.getElementById('epub-content');
    if (!scrollEl || !contentEl) return;

    const cH = scrollEl.clientHeight;
    const cW = scrollEl.clientWidth;
    scrollEl.classList.remove('page-turning');
    scrollEl.scrollLeft = 0;
    contentEl.style.transform = '';
    contentEl.style.height      = cH + 'px';

    if (epubDirection === 'vertical') {
      contentEl.style.width       = cW + 'px';
      contentEl.style.minWidth    = '';
      contentEl.style.columnWidth = '';
      contentEl.style.columnGap   = '';
      contentEl.style.columnFill  = '';
      renderEpubContentForLayout(contentEl, cW, cH);
    } else {
      const pageGap = Math.min(48, Math.max(24, Math.round(cW * 0.035)));
      const pageContentW = Math.max(160, cW - pageGap);
      contentEl.style.width       = cW + 'px';
      contentEl.style.minWidth    = '';
      contentEl.style.columnWidth = pageContentW + 'px';
      contentEl.style.columnGap   = pageGap + 'px';
      contentEl.style.columnFill  = 'auto';
      renderEpubContentForLayout(contentEl, cW, cH);
    }

    epubPageStep = cW;

    // 等多列回流完成后计算总页数并定位
    requestAnimationFrame(() => {
      const el = document.getElementById('epub-content');
      const se = document.getElementById('epub-scroll');
      if (!el || !se) return;

      epubVerticalScrollSign = epubDirection === 'vertical' ? 1 : detectEpubVerticalScrollSign(se);
      epubTotalPages = epubDirection === 'vertical'
        ? Math.max(1, el.querySelectorAll('.epub-vpage').length)
        : Math.max(1, Math.ceil(measureEpubSpread(el, se) / epubPageStep));
      if (resetToStart) epubPageNum = 0;
      goToEpubPage(epubPageNum, false);
      el.style.opacity   = '1';
      updateEpubNav();
    });
  });
}

function renderEpubContentForLayout(contentEl, pageW, pageH) {
  if (!epubCurrentChapter) return;

  contentEl.innerHTML = '';
  contentEl.classList.toggle('vertical-pages', epubDirection === 'vertical');

  if (epubDirection === 'vertical') {
    renderVerticalPages(epubCurrentChapter, contentEl, pageW, pageH);
  } else {
    Renderer.render(epubCurrentChapter, contentEl);
  }
}

function renderVerticalPages(chapter, container, pageW, pageH) {
  const pages = [];
  let page = createVerticalPage(pageW, pageH);
  container.appendChild(page.el);
  pages.push(page);

  for (const block of chapter.blocks) {
    page = appendBlockToVerticalPages(block, container, pages, pageW, pageH);
  }

  container.style.width = (pages.length * pageW) + 'px';
}

function createVerticalPage(pageW, pageH) {
  const el = document.createElement('section');
  el.className = 'epub-vpage';
  el.style.width = pageW + 'px';
  el.style.height = pageH + 'px';

  const body = document.createElement('div');
  body.className = 'epub-vpage-body';
  el.appendChild(body);

  return { el, body };
}

function appendBlockToVerticalPages(block, container, pages, pageW, pageH) {
  let page = pages[pages.length - 1];
  const el = Renderer._renderBlock(block);
  if (!el) return page;

  page.body.appendChild(el);
  if (!verticalPageOverflows(page.body)) return page;

  page.body.removeChild(el);
  if (page.body.childNodes.length > 0) {
    page = createVerticalPage(pageW, pageH);
    container.appendChild(page.el);
    pages.push(page);
    page.body.appendChild(el);
    if (!verticalPageOverflows(page.body)) return page;
    page.body.removeChild(el);
  }

  return splitBlockIntoVerticalPages(block, container, pages, pageW, pageH);
}

function splitBlockIntoVerticalPages(block, container, pages, pageW, pageH) {
  if (!block.nodes?.length || block.type === 'break') {
    const page = pages[pages.length - 1];
    const el = Renderer._renderBlock(block);
    if (el) page.body.appendChild(el);
    return page;
  }

  let page = pages[pages.length - 1];
  let blockEl = createEmptyBlockElement(block);
  page.body.appendChild(blockEl);

  for (const unit of flattenInlineUnits(block.nodes)) {
    const node = renderInlineUnit(unit);
    blockEl.appendChild(node);

    if (!verticalPageOverflows(page.body)) continue;

    blockEl.removeChild(node);

    if (!blockEl.hasChildNodes()) {
      blockEl.appendChild(node);
      continue;
    }

    page = createVerticalPage(pageW, pageH);
    container.appendChild(page.el);
    pages.push(page);
    blockEl = createEmptyBlockElement(block);
    page.body.appendChild(blockEl);
    blockEl.appendChild(node);
  }

  return page;
}

function createEmptyBlockElement(block) {
  if (block.type === 'heading') {
    const level = Math.min(6, Math.max(1, block.level || 1));
    const el = document.createElement(`h${level}`);
    el.className = `r-h r-h${level}`;
    return el;
  }

  const el = document.createElement('p');
  el.className = 'r-p';
  return el;
}

function flattenInlineUnits(nodes) {
  const units = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      for (const char of [...node.content]) units.push({ type: 'text', content: char });
    } else {
      units.push(node);
    }
  }
  return units;
}

function renderInlineUnit(unit) {
  if (unit.type === 'text') return document.createTextNode(unit.content);
  return Renderer._renderNode(unit) || document.createTextNode('');
}

function verticalPageOverflows(pageBody) {
  return pageBody.scrollWidth > pageBody.clientWidth + 2;
}

function measureEpubSpread(contentEl, scrollEl) {
  const spreadFromRects = (rects) => {
    let minLeft = Infinity;
    let maxRight = -Infinity;

    for (const rect of rects) {
      if (!rect.width && !rect.height) continue;
      minLeft = Math.min(minLeft, rect.left);
      maxRight = Math.max(maxRight, rect.right);
    }

    return Number.isFinite(minLeft) ? (maxRight - minLeft) : 0;
  };

  const range = document.createRange();
  range.selectNodeContents(contentEl);
  const textSpread = spreadFromRects(range.getClientRects());
  range.detach();

  const blockSpread = spreadFromRects(
    [...contentEl.querySelectorAll('.r-p, .r-h, ruby, br')]
      .flatMap(el => [...el.getClientRects()])
  );

  return Math.max(contentEl.scrollWidth, scrollEl.scrollWidth, textSpread, blockSpread);
}

function detectEpubVerticalScrollSign(scrollEl) {
  if (epubDirection !== 'vertical') return 1;

  scrollEl.scrollLeft = 0;
  scrollEl.scrollLeft = -1;
  if (scrollEl.scrollLeft < 0) {
    scrollEl.scrollLeft = 0;
    return -1;
  }

  scrollEl.scrollLeft = 1;
  if (scrollEl.scrollLeft > 0) {
    scrollEl.scrollLeft = 0;
    return 1;
  }

  scrollEl.scrollLeft = 0;
  return -1;
}

function getEpubScrollLeft(pageNum) {
  // vertical-rl 的下一页在当前页左侧；现代浏览器用负 scrollLeft 表示向左翻。
  return epubDirection === 'vertical'
    ? epubVerticalScrollSign * pageNum * epubPageStep
    : pageNum * epubPageStep;
}

function goToEpubPage(pageNum, animated = true) {
  const scrollEl = document.getElementById('epub-scroll');
  if (!scrollEl) return;

  epubPageNum = Math.min(Math.max(pageNum, 0), Math.max(epubTotalPages - 1, 0));
  scrollEl.classList.toggle('page-turning', animated);

  scrollEl.scrollTo({
    left: getEpubScrollLeft(epubPageNum),
    top: 0,
    behavior: animated ? 'smooth' : 'auto',
  });
  updateEpubNav();
}

function updateEpubNav() {
  const info  = epubChapterList[epubCurrentIndex];
  const title = info?.title ? `  ${info.title}` : '';
  document.getElementById('page-info').textContent =
    `${epubCurrentIndex + 1} / ${epubChapterList.length}${title}  [${epubPageNum + 1} / ${epubTotalPages}]`;
  document.getElementById('prev-btn').disabled = false;
  document.getElementById('next-btn').disabled = false;
}

// ─── 章节内翻页 ─────────────────────────────────────────────────────────────

function epubPageNext() {
  if (epubPageNum >= epubTotalPages - 1) {
    if (epubCurrentIndex < epubChapterList.length - 1)
      renderEpubChapter(epubCurrentIndex + 1);
    return;
  }

  goToEpubPage(epubPageNum + 1);
}

function epubPagePrev() {
  if (epubPageNum <= 0) {
    if (epubCurrentIndex > 0)
      renderEpubChapter(epubCurrentIndex - 1);
    return;
  }

  goToEpubPage(epubPageNum - 1);
}

// ─── 竖/横排切换 ──────────────────────────────────────────────────────────────

function toggleEpubDirection() {
  epubDirection = epubDirection === 'horizontal' ? 'vertical' : 'horizontal';

  const epubEl = document.getElementById('epub-reader');
  if (epubEl) epubEl.className = `epub-reader layout-${epubDirection}`;

  const dirBtn = document.getElementById('direction-btn');
  if (dirBtn) dirBtn.textContent = epubDirection === 'horizontal' ? '竖排' : '横排';

  initEpubLayout(true);
}

document.getElementById('direction-btn').addEventListener('click', () => {
  if (readerType === 'epub') toggleEpubDirection();
});

function onEpubReaderClick(e) {
  if (readerType !== 'epub') return;

  const selectionText = getCleanSelectionText(window.getSelection());
  if (selectionText) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const leftZone = rect.width * 0.28;
  const rightZone = rect.width * 0.72;

  if (x <= leftZone) {
    epubPagePrev();
  } else if (x >= rightZone) {
    epubPageNext();
  }
}

// ─── 目录（TOC）──────────────────────────────────────────────────────────────

function toggleToc() {
  epubTocOpen = !epubTocOpen;
  document.getElementById('toc-panel').classList.toggle('hidden', !epubTocOpen);
}

function populateToc() {
  const list = document.getElementById('toc-list');
  list.innerHTML = '';

  const toc = epubBook?.navigation?.toc || [];

  if (toc.length) {
    renderTocItems(toc, list, 0);
  } else {
    // 备用：用 spine 章节列表
    epubChapterList.forEach((ch, i) => {
      const li = document.createElement('li');
      li.className = 'toc-item';
      li.textContent = ch.title || `第 ${i + 1} 章`;
      li.dataset.index = String(i);
      li.addEventListener('click', () => renderEpubChapter(i));
      list.appendChild(li);
    });
  }
}

function renderTocItems(items, container, depth) {
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'toc-item';
    li.style.paddingLeft = (16 + depth * 16) + 'px';
    li.textContent = (item.label || '').trim() || '（无标题）';

    const rawHref = (item.href || '').split('#')[0];
    const idx = findSpineIndex(rawHref);
    li.dataset.index = String(idx);

    if (idx >= 0) {
      li.addEventListener('click', () => renderEpubChapter(idx));
    } else {
      li.style.opacity = '0.5';
      li.style.cursor  = 'default';
    }

    container.appendChild(li);
    if (item.subitems?.length) renderTocItems(item.subitems, container, depth + 1);
  }
}

function findSpineIndex(href) {
  // 精确匹配
  let idx = epubChapterList.findIndex(ch => ch.href === href);
  if (idx >= 0) return idx;
  // 文件名匹配（去路径前缀）
  const name = href.split('/').pop();
  if (!name) return -1;
  idx = epubChapterList.findIndex(ch => ch.href.split('/').pop() === name);
  return idx;
}

function updateTocHighlight(chapterIndex) {
  document.querySelectorAll('#toc-list .toc-item').forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    const active = idx === chapterIndex;
    el.classList.toggle('toc-item-active', active);
    if (active) el.scrollIntoView({ block: 'nearest' });
  });
}

document.getElementById('toc-btn').addEventListener('click', toggleToc);

// ─── 窗口大小变化（外接屏幕等）────────────────────────────────────────────────

window.addEventListener('resize', () => {
  if (readerType !== 'epub') return;
  clearTimeout(epubResizeTimer);
  epubResizeTimer = setTimeout(() => initEpubLayout(true), 300);
});

// ═══════════════════════════════════════════════════════════════════════════════
// PDF
// ═══════════════════════════════════════════════════════════════════════════════

async function loadPdf(file) {
  if (typeof pdfjsLib === 'undefined') {
    alert('PDF.js 未加载，请检查网络连接后刷新页面。');
    return;
  }

  readerType = 'pdf';
  UI.setBookTitle('加载中...');
  document.getElementById('placeholder').classList.add('hidden');

  const arrayBuffer = await file.arrayBuffer();
  pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  UI.setBookTitle(file.name);
  document.getElementById('prev-btn').textContent = '← 上一页';
  document.getElementById('next-btn').textContent = '下一页 →';
  UI.showNavigation();

  document.addEventListener('mouseup', onMainDocMouseUp);

  await renderPdfPage(1);
}

async function renderPdfPage(pageNum) {
  if (!pdfDoc) return;
  pageNum = Math.max(1, Math.min(pageNum, pdfDoc.numPages));
  currentPdfPage = pageNum;

  const page     = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: currentPdfScale });

  const container = document.getElementById('reader');
  container.innerHTML = '';
  container.style.cssText = 'overflow:auto; display:flex; justify-content:center; ' +
                             'align-items:flex-start; padding:20px 0; background:#e0ddd8;';

  const pageDiv = document.createElement('div');
  pageDiv.className = 'pdf-page';
  pageDiv.style.width  = viewport.width  + 'px';
  pageDiv.style.height = viewport.height + 'px';

  const canvas   = document.createElement('canvas');
  canvas.width   = viewport.width;
  canvas.height  = viewport.height;

  const textLayerDiv = document.createElement('div');
  textLayerDiv.className = 'pdf-text-layer';

  pageDiv.appendChild(canvas);
  pageDiv.appendChild(textLayerDiv);
  container.appendChild(pageDiv);

  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

  try {
    const textContent = await page.getTextContent();
    const task = pdfjsLib.renderTextLayer({ textContent, container: textLayerDiv, viewport, textDivs: [] });
    if (task?.promise) await task.promise;
  } catch (e) {
    console.warn('[pdf] 文字层渲染失败:', e);
  }

  document.getElementById('page-info').textContent = `${pageNum} / ${pdfDoc.numPages}`;
  document.getElementById('prev-btn').disabled = pageNum <= 1;
  document.getElementById('next-btn').disabled = pageNum >= pdfDoc.numPages;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TXT
// ═══════════════════════════════════════════════════════════════════════════════

async function loadTxt(file) {
  readerType = 'txt';
  UI.setBookTitle(file.name);
  document.getElementById('placeholder').classList.add('hidden');

  const text = await decodeTxtFile(file);

  const container = document.getElementById('reader');
  container.innerHTML = '';
  container.style.cssText = 'overflow:auto; padding:40px 60px; background:var(--color-bg);';

  const textDiv = document.createElement('div');
  textDiv.className = 'txt-content';
  textDiv.textContent = text;
  container.appendChild(textDiv);

  document.addEventListener('mouseup', onMainDocMouseUp);

  document.getElementById('navigation').hidden = true;
}

/**
 * 带编码检测的文本文件读取。
 * 优先级：UTF BOM → UTF-8（严格）→ Shift-JIS → UTF-8（宽容）
 */
async function decodeTxtFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes  = new Uint8Array(buffer);

  if (bytes[0] === 0xFF && bytes[1] === 0xFE)
    return new TextDecoder('utf-16le').decode(buffer.slice(2));
  if (bytes[0] === 0xFE && bytes[1] === 0xFF)
    return new TextDecoder('utf-16be').decode(buffer.slice(2));
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF)
    return new TextDecoder('utf-8').decode(buffer.slice(3));

  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch {}
  try { return new TextDecoder('shift-jis', { fatal: true }).decode(buffer); } catch {}
  return new TextDecoder('utf-8').decode(buffer);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 公共交互
// ═══════════════════════════════════════════════════════════════════════════════

// ── 主文档选区（EPUB / PDF / TXT 共用）───────────────────────────────────────

function onMainDocMouseUp() {
  setTimeout(() => {
    const sel  = window.getSelection();
    const text = getCleanSelectionText(sel);
    if (text) { selectedText = text; UI.setAnalyzeBtnEnabled(true); }
    else       { selectedText = '';  UI.setAnalyzeBtnEnabled(false); }
  }, 80);
}

function getCleanSelectionText(sel) {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return '';
  try {
    const fragment = sel.getRangeAt(0).cloneContents();
    fragment.querySelectorAll('rt, rp').forEach(el => el.remove());
    return fragment.textContent.trim();
  } catch {
    return sel.toString().trim();
  }
}

// ── 分析按钮 ──────────────────────────────────────────────────────────────────

document.getElementById('analyze-btn').addEventListener('click', async () => {
  if (!selectedText) {
    UI.showError('请先在文章中选中需要分析的文字。');
    return;
  }

  const text = selectedText;
  selectedText = '';
  UI.setAnalyzeBtnEnabled(false);
  UI.showLoading(text);

  try {
    const result = await API.analyzeText(text);
    UI.showResult(result);
  } catch (err) {
    UI.showError(err.message || '请求失败，请检查后端是否运行。');
  }
});

// ── 翻页导航（EPUB：页内翻页+换章；PDF：换页）────────────────────────────────

document.getElementById('prev-btn').addEventListener('click', () => {
  if (readerType === 'epub') {
    epubPagePrev();
    selectedText = '';
    UI.setAnalyzeBtnEnabled(false);
  } else if (readerType === 'pdf') {
    renderPdfPage(currentPdfPage - 1);
  }
});

document.getElementById('next-btn').addEventListener('click', () => {
  if (readerType === 'epub') {
    epubPageNext();
    selectedText = '';
    UI.setAnalyzeBtnEnabled(false);
  } else if (readerType === 'pdf') {
    renderPdfPage(currentPdfPage + 1);
  }
});

document.addEventListener('keydown', (e) => {
  if (readerType === 'epub') {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const prev = e.key === 'ArrowLeft'  || e.key === 'ArrowUp';
    if (!next && !prev) return;
    next ? epubPageNext() : epubPagePrev();
  } else if (readerType === 'pdf') {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const prev = e.key === 'ArrowLeft'  || e.key === 'ArrowUp';
    if (!next && !prev) return;
    next ? renderPdfPage(currentPdfPage + 1) : renderPdfPage(currentPdfPage - 1);
  }
});

// ── 字体 / 缩放调节 ────────────────────────────────────────────────────────────

document.getElementById('font-decrease').addEventListener('click', () => adjustSize(-1));
document.getElementById('font-increase').addEventListener('click', () => adjustSize(+1));

function adjustSize(direction) {
  const { FONT_SIZE_STEP: step, FONT_SIZE_MIN: min, FONT_SIZE_MAX: max } = CONFIG.READER;

  if (readerType === 'epub') {
    currentFontSize = Math.min(max, Math.max(min, currentFontSize + direction * step));
    UI.updateFontSizeLabel(currentFontSize);
    const contentEl = document.getElementById('epub-content');
    if (contentEl) contentEl.style.fontSize = currentFontSize + '%';
    // 字体变化后重新计算布局（尤其竖排需要更新列高）
    initEpubLayout(true);

  } else if (readerType === 'pdf') {
    currentPdfScale = Math.min(4.0, Math.max(0.5, currentPdfScale + direction * 0.2));
    currentFontSize = Math.round((currentPdfScale / 1.5) * 100);
    UI.updateFontSizeLabel(currentFontSize);
    renderPdfPage(currentPdfPage);

  } else if (readerType === 'txt') {
    currentFontSize = Math.min(max, Math.max(min, currentFontSize + direction * step));
    UI.updateFontSizeLabel(currentFontSize);
    const el = document.querySelector('.txt-content');
    if (el) el.style.fontSize = currentFontSize + '%';
  }
}

// ── 后端初始化 ─────────────────────────────────────────────────────────────────

async function initBackend() {
  try {
    const data = await API.getProviders();
    UI.populateProviders(data.providers, data.current);
    UI.setStatus(true);
  } catch {
    UI.setStatus(false);
    document.getElementById('provider-select').innerHTML =
      '<option value="">后端未连接</option>';
  }
}

document.getElementById('provider-select').addEventListener('change', async (e) => {
  const provider = e.target.value;
  if (!provider) return;
  try {
    await API.switchProvider(provider);
  } catch (err) {
    alert(`切换失败：${err.message}`);
    initBackend();
  }
});

initBackend();
