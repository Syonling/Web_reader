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
let epubResizeTimer  = null;
let epubPendingPageAnchor = null;     // 重排后恢复当前页开头的源码位置
let epubPendingPageTarget = null;     // 'start' | 'end' | number
let epubTemporaryAnchorActive = false; // 缩放/切换后临时固定当前页开头
const chapterCache   = new Map();    // index → Chapter

// TXT 专用
let txtRawText = '';
let txtPageNum = 0;
let txtTotalPages = 1;
let txtPageStep = 1;
let txtPendingPageAnchor = null;
let txtTemporaryAnchorActive = false;

// 阅读设置
let readerTheme = 'original';
let pageTurnMode = 'slide';           // 'slide' | 'instant'
const FORCED_BREAK_MIN_FILL = 0.68;

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
  epubPendingPageAnchor = null;
  epubPendingPageTarget = null;
  epubTemporaryAnchorActive = false;
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
  txtRawText      = '';
  txtPageNum      = 0;
  txtTotalPages   = 1;
  txtPageStep     = 1;
  txtPendingPageAnchor = null;
  txtTemporaryAnchorActive = false;

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

async function renderEpubChapter(index, pageTarget = 'start') {
  if (index < 0 || index >= epubChapterList.length) return;
  epubCurrentIndex = index;
  epubPendingPageTarget = pageTarget;
  epubTemporaryAnchorActive = false;

  const chapter   = await getEpubChapter(index);
  epubCurrentChapter = chapter;
  const contentEl = document.getElementById('epub-content');
  if (!contentEl) return;

  // 渲染前隐藏，避免短暂闪现错误位置的内容
  contentEl.style.cssText = 'opacity:0; font-size:' + currentFontSize + '%;';
  contentEl.innerHTML = '';

  // 布局初始化（设置容器尺寸 + 定位到目标页）
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
      renderEpubContentForLayout(contentEl, cW, cH, epubPendingPageAnchor);
    } else {
      contentEl.style.width       = cW + 'px';
      contentEl.style.minWidth    = '';
      contentEl.style.columnWidth = '';
      contentEl.style.columnGap   = '';
      contentEl.style.columnFill  = '';
      renderEpubContentForLayout(contentEl, cW, cH, epubPendingPageAnchor);
    }

    epubPageStep = cW;

    // 等多列回流完成后计算总页数并定位
    requestAnimationFrame(() => {
      const el = document.getElementById('epub-content');
      const se = document.getElementById('epub-scroll');
      if (!el || !se) return;

      epubTotalPages = Math.max(1, el.querySelectorAll('.epub-page').length);
      if (epubPendingPageTarget != null) {
        epubPageNum = resolveEpubPageTarget(epubPendingPageTarget);
        epubPendingPageTarget = null;
      } else if (epubPendingPageAnchor != null) {
        epubPageNum = findEpubPageByAnchor(epubPendingPageAnchor);
        epubPendingPageAnchor = null;
        epubTemporaryAnchorActive = true;
      } else if (resetToStart) {
        epubPageNum = 0;
        epubTemporaryAnchorActive = false;
      }
      goToEpubPage(epubPageNum, false);
      el.style.opacity   = '1';
      updateEpubNav();
    });
  });
}

function resolveEpubPageTarget(target) {
  if (target === 'end') return Math.max(epubTotalPages - 1, 0);
  if (target === 'start') return 0;
  if (typeof target === 'number') return Math.min(Math.max(target, 0), Math.max(epubTotalPages - 1, 0));
  return 0;
}

function relayoutEpubKeepingPosition() {
  epubPendingPageAnchor = getCurrentEpubPageAnchor();
  initEpubLayout(false);
}

function repaginateEpubNaturallyAroundAnchor(anchor, pageDelta) {
  const contentEl = document.getElementById('epub-content');
  const scrollEl = document.getElementById('epub-scroll');
  if (!contentEl || !scrollEl) return false;

  const pageW = scrollEl.clientWidth;
  const pageH = scrollEl.clientHeight;
  contentEl.style.height = pageH + 'px';
  contentEl.style.width = pageW + 'px';
  renderEpubContentForLayout(contentEl, pageW, pageH, null);

  epubPageStep = pageW;
  epubTotalPages = Math.max(1, contentEl.querySelectorAll('.epub-page').length);
  const naturalPage = findEpubPageByAnchor(anchor);
  epubTemporaryAnchorActive = false;
  goToEpubPage(naturalPage + pageDelta, false);
  return true;
}

function getCurrentEpubPageAnchor() {
  const page = document.querySelectorAll('#epub-content .epub-page')[epubPageNum];
  if (!page) return 0;
  return parseInt(page.dataset.startUnit || '0', 10);
}

function findEpubPageByAnchor(anchor) {
  const pages = [...document.querySelectorAll('#epub-content .epub-page')];
  if (!pages.length) return 0;

  for (let i = 0; i < pages.length; i++) {
    const start = parseInt(pages[i].dataset.startUnit || '0', 10);
    const end = parseInt(pages[i].dataset.endUnit || String(start + 1), 10);
    if (anchor >= start && anchor < end) return i;
    if (anchor < start) return Math.max(0, i - 1);
  }

  return pages.length - 1;
}

function renderEpubContentForLayout(contentEl, pageW, pageH, forcedPageStart = null) {
  if (!epubCurrentChapter) return;

  contentEl.innerHTML = '';
  contentEl.classList.toggle('vertical-pages', epubDirection === 'vertical');
  contentEl.classList.toggle('horizontal-pages', epubDirection === 'horizontal');

  renderPaginatedEpubPages(epubCurrentChapter, contentEl, pageW, pageH, epubDirection, forcedPageStart);
}

function renderPaginatedEpubPages(chapter, container, pageW, pageH, direction, forcedPageStart = null) {
  const pages = [];
  let page = createEpubPage(pageW, pageH, direction);
  container.appendChild(page.el);
  pages.push(page);

  let unitIndex = 0;
  for (const block of chapter.blocks) {
    const result = appendBlockToEpubPages(block, container, pages, pageW, pageH, direction, unitIndex, forcedPageStart);
    page = result.page;
    unitIndex = result.nextUnitIndex;
  }

  container.style.width = (pages.length * pageW) + 'px';
}

function createEpubPage(pageW, pageH, direction) {
  const el = document.createElement('section');
  el.className = direction === 'vertical' ? 'epub-page epub-vpage' : 'epub-page epub-hpage';
  el.style.width = pageW + 'px';
  el.style.height = pageH + 'px';

  const body = document.createElement('div');
  body.className = direction === 'vertical' ? 'epub-vpage-body' : 'epub-hpage-body';
  el.appendChild(body);

  return { el, body };
}

function markPageUnit(page, unitIndex) {
  if (page.el.dataset.startUnit == null) page.el.dataset.startUnit = String(unitIndex);
  page.el.dataset.endUnit = String(unitIndex + 1);
}

function appendBlockToEpubPages(block, container, pages, pageW, pageH, direction, unitIndex, forcedPageStart = null) {
  let page = pages[pages.length - 1];
  if (!block.nodes?.length || block.type === 'break') {
    if (unitIndex === forcedPageStart && shouldForceEpubBreak(page.body, direction)) {
      page = createEpubPage(pageW, pageH, direction);
      container.appendChild(page.el);
      pages.push(page);
    }
    const el = Renderer._renderBlock(block);
    if (el) page.body.appendChild(el);
    markPageUnit(page, unitIndex);
    return { page, nextUnitIndex: unitIndex + 1 };
  }

  let blockEl = null;

  for (const unit of flattenInlineUnits(block.nodes)) {
    if (unitIndex === forcedPageStart && shouldForceEpubBreak(page.body, direction)) {
      if (blockEl && !blockEl.hasChildNodes()) page.body.removeChild(blockEl);
      page = createEpubPage(pageW, pageH, direction);
      container.appendChild(page.el);
      pages.push(page);
      blockEl = null;
    }

    if (!blockEl) {
      blockEl = createEmptyBlockElement(block);
      page.body.appendChild(blockEl);
    }

    const node = renderInlineUnit(unit);
    blockEl.appendChild(node);
    markPageUnit(page, unitIndex);

    if (!epubPageOverflows(page.body, direction)) {
      unitIndex++;
      continue;
    }

    blockEl.removeChild(node);
    page.el.dataset.endUnit = String(unitIndex);

    if (!blockEl.hasChildNodes()) {
      blockEl.appendChild(node);
      markPageUnit(page, unitIndex);
      unitIndex++;
      continue;
    }

    page = createEpubPage(pageW, pageH, direction);
    container.appendChild(page.el);
    pages.push(page);
    blockEl = createEmptyBlockElement(block);
    page.body.appendChild(blockEl);
    blockEl.appendChild(node);
    markPageUnit(page, unitIndex);
    unitIndex++;
  }

  return { page, nextUnitIndex: unitIndex };
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

function epubPageOverflows(pageBody, direction) {
  return direction === 'vertical'
    ? pageBody.scrollWidth > pageBody.clientWidth + 2
    : pageBody.scrollHeight > pageBody.clientHeight + 2;
}

function getEpubPageFillRatio(pageBody, direction) {
  const used = direction === 'vertical' ? pageBody.scrollWidth : pageBody.scrollHeight;
  const available = direction === 'vertical' ? pageBody.clientWidth : pageBody.clientHeight;
  if (available <= 0) return 1;
  return Math.min(1, used / available);
}

function shouldForceEpubBreak(pageBody, direction) {
  if (!pageBody.childNodes.length) return false;
  return getEpubPageFillRatio(pageBody, direction) >= FORCED_BREAK_MIN_FILL;
}

function getEpubScrollLeft(pageNum) {
  return pageNum * epubPageStep;
}

function goToEpubPage(pageNum, animated = true) {
  const scrollEl = document.getElementById('epub-scroll');
  if (!scrollEl) return;

  epubPageNum = Math.min(Math.max(pageNum, 0), Math.max(epubTotalPages - 1, 0));
  const smooth = animated && pageTurnMode === 'slide';
  scrollEl.classList.toggle('page-turning', smooth);

  scrollEl.scrollTo({
    left: getEpubScrollLeft(epubPageNum),
    top: 0,
    behavior: smooth ? 'smooth' : 'auto',
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
  if (epubTemporaryAnchorActive) {
    const anchor = getCurrentEpubPageAnchor();
    if (repaginateEpubNaturallyAroundAnchor(anchor, 1)) return;
  }

  if (epubPageNum >= epubTotalPages - 1) {
    if (epubCurrentIndex < epubChapterList.length - 1)
      renderEpubChapter(epubCurrentIndex + 1, 'start');
    return;
  }

  goToEpubPage(epubPageNum + 1);
}

function epubPagePrev() {
  if (epubTemporaryAnchorActive) {
    const anchor = getCurrentEpubPageAnchor();
    if (repaginateEpubNaturallyAroundAnchor(anchor, -1)) return;
  }

  if (epubPageNum <= 0) {
    if (epubCurrentIndex > 0)
      renderEpubChapter(epubCurrentIndex - 1, 'end');
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

  relayoutEpubKeepingPosition();
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
  clearTimeout(epubResizeTimer);
  if (readerType === 'epub') {
    epubResizeTimer = setTimeout(relayoutEpubKeepingPosition, 300);
  } else if (readerType === 'txt') {
    epubResizeTimer = setTimeout(relayoutTxtKeepingPosition, 300);
  }
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

  txtRawText = await decodeTxtFile(file);

  const container = document.getElementById('reader');
  container.innerHTML = '';
  container.removeAttribute('style');

  const txtEl = document.createElement('div');
  txtEl.id = 'txt-reader';
  txtEl.className = 'txt-reader';

  const scrollEl = document.createElement('div');
  scrollEl.id = 'txt-scroll';
  scrollEl.className = 'txt-scroll';

  const pagesEl = document.createElement('div');
  pagesEl.id = 'txt-pages';
  pagesEl.className = 'txt-pages';
  pagesEl.style.fontSize = currentFontSize + '%';

  scrollEl.appendChild(pagesEl);
  txtEl.appendChild(scrollEl);
  container.appendChild(txtEl);

  txtEl.addEventListener('click', onTxtReaderClick);

  document.addEventListener('mouseup', onMainDocMouseUp);

  document.getElementById('prev-btn').textContent = '← 上一页';
  document.getElementById('next-btn').textContent = '下一页 →';
  UI.showNavigation();

  initTxtLayout(true);
}

function initTxtLayout(resetToStart = true) {
  requestAnimationFrame(() => {
    const scrollEl = document.getElementById('txt-scroll');
    const pagesEl = document.getElementById('txt-pages');
    if (!scrollEl || !pagesEl) return;

    const cH = scrollEl.clientHeight;
    const cW = scrollEl.clientWidth;
    scrollEl.classList.remove('page-turning');
    scrollEl.scrollLeft = 0;
    pagesEl.style.height = cH + 'px';
    pagesEl.style.width = cW + 'px';
    txtPageStep = cW;

    renderTxtPages(pagesEl, cW, cH, txtPendingPageAnchor);

    requestAnimationFrame(() => {
      txtTotalPages = Math.max(1, pagesEl.querySelectorAll('.txt-page').length);
      if (txtPendingPageAnchor != null) {
        txtPageNum = findTxtPageByAnchor(txtPendingPageAnchor);
        txtPendingPageAnchor = null;
        txtTemporaryAnchorActive = true;
      } else if (resetToStart) {
        txtPageNum = 0;
        txtTemporaryAnchorActive = false;
      }
      goToTxtPage(txtPageNum, false);
    });
  });
}

function renderTxtPages(container, pageW, pageH, forcedPageStart = null) {
  container.innerHTML = '';
  const pages = [];
  let page = createTxtPage(pageW, pageH);
  container.appendChild(page.el);
  pages.push(page);

  for (let i = 0; i < txtRawText.length; i++) {
    if (i === forcedPageStart && page.body.hasChildNodes()) {
      page = createTxtPage(pageW, pageH);
      container.appendChild(page.el);
      pages.push(page);
    }

    const node = document.createTextNode(txtRawText[i]);
    page.body.appendChild(node);
    markTxtPageUnit(page, i);

    if (page.body.scrollHeight <= page.body.clientHeight + 2) continue;

    page.body.removeChild(node);
    page.el.dataset.endUnit = String(i);

    if (!page.body.hasChildNodes()) {
      page.body.appendChild(node);
      markTxtPageUnit(page, i);
      continue;
    }

    page = createTxtPage(pageW, pageH);
    container.appendChild(page.el);
    pages.push(page);
    page.body.appendChild(node);
    markTxtPageUnit(page, i);
  }

  container.style.width = (pages.length * pageW) + 'px';
}

function createTxtPage(pageW, pageH) {
  const el = document.createElement('section');
  el.className = 'txt-page';
  el.style.width = pageW + 'px';
  el.style.height = pageH + 'px';

  const body = document.createElement('div');
  body.className = 'txt-page-body';
  el.appendChild(body);
  return { el, body };
}

function markTxtPageUnit(page, unitIndex) {
  if (page.el.dataset.startUnit == null) page.el.dataset.startUnit = String(unitIndex);
  page.el.dataset.endUnit = String(unitIndex + 1);
}

function getCurrentTxtPageAnchor() {
  const page = document.querySelectorAll('#txt-pages .txt-page')[txtPageNum];
  if (!page) return 0;
  return parseInt(page.dataset.startUnit || '0', 10);
}

function findTxtPageByAnchor(anchor) {
  const pages = [...document.querySelectorAll('#txt-pages .txt-page')];
  if (!pages.length) return 0;

  for (let i = 0; i < pages.length; i++) {
    const start = parseInt(pages[i].dataset.startUnit || '0', 10);
    const end = parseInt(pages[i].dataset.endUnit || String(start + 1), 10);
    if (anchor >= start && anchor < end) return i;
    if (anchor < start) return Math.max(0, i - 1);
  }
  return pages.length - 1;
}

function relayoutTxtKeepingPosition() {
  txtPendingPageAnchor = getCurrentTxtPageAnchor();
  initTxtLayout(false);
}

function repaginateTxtNaturallyAroundAnchor(anchor, pageDelta) {
  const pagesEl = document.getElementById('txt-pages');
  const scrollEl = document.getElementById('txt-scroll');
  if (!pagesEl || !scrollEl) return false;

  const pageW = scrollEl.clientWidth;
  const pageH = scrollEl.clientHeight;
  pagesEl.style.height = pageH + 'px';
  pagesEl.style.width = pageW + 'px';
  renderTxtPages(pagesEl, pageW, pageH, null);

  txtPageStep = pageW;
  txtTotalPages = Math.max(1, pagesEl.querySelectorAll('.txt-page').length);
  const naturalPage = findTxtPageByAnchor(anchor);
  txtTemporaryAnchorActive = false;
  goToTxtPage(naturalPage + pageDelta, false);
  return true;
}

function goToTxtPage(pageNum, animated = true) {
  const scrollEl = document.getElementById('txt-scroll');
  if (!scrollEl) return;

  txtPageNum = Math.min(Math.max(pageNum, 0), Math.max(txtTotalPages - 1, 0));
  const smooth = animated && pageTurnMode === 'slide';
  scrollEl.classList.toggle('page-turning', smooth);
  scrollEl.scrollTo({
    left: txtPageNum * txtPageStep,
    top: 0,
    behavior: smooth ? 'smooth' : 'auto',
  });
  updateTxtNav();
}

function txtPageNext() {
  if (txtTemporaryAnchorActive) {
    const anchor = getCurrentTxtPageAnchor();
    if (repaginateTxtNaturallyAroundAnchor(anchor, 1)) return;
  }

  if (txtPageNum < txtTotalPages - 1) goToTxtPage(txtPageNum + 1);
}

function txtPagePrev() {
  if (txtTemporaryAnchorActive) {
    const anchor = getCurrentTxtPageAnchor();
    if (repaginateTxtNaturallyAroundAnchor(anchor, -1)) return;
  }

  if (txtPageNum > 0) goToTxtPage(txtPageNum - 1);
}

function updateTxtNav() {
  document.getElementById('page-info').textContent = `${txtPageNum + 1} / ${txtTotalPages}`;
  document.getElementById('prev-btn').disabled = txtPageNum <= 0;
  document.getElementById('next-btn').disabled = txtPageNum >= txtTotalPages - 1;
}

function onTxtReaderClick(e) {
  if (readerType !== 'txt') return;

  const selectionText = getCleanSelectionText(window.getSelection());
  if (selectionText) return;

  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (x <= rect.width * 0.28) txtPagePrev();
  else if (x >= rect.width * 0.72) txtPageNext();
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
  } else if (readerType === 'txt') {
    txtPagePrev();
    selectedText = '';
    UI.setAnalyzeBtnEnabled(false);
  }
});

document.getElementById('next-btn').addEventListener('click', () => {
  if (readerType === 'epub') {
    epubPageNext();
    selectedText = '';
    UI.setAnalyzeBtnEnabled(false);
  } else if (readerType === 'pdf') {
    renderPdfPage(currentPdfPage + 1);
  } else if (readerType === 'txt') {
    txtPageNext();
    selectedText = '';
    UI.setAnalyzeBtnEnabled(false);
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
  } else if (readerType === 'txt') {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    const prev = e.key === 'ArrowLeft'  || e.key === 'ArrowUp';
    if (!next && !prev) return;
    next ? txtPageNext() : txtPagePrev();
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
    // 字体变化后重新计算布局，同时保留当前章节内阅读位置
    relayoutEpubKeepingPosition();

  } else if (readerType === 'pdf') {
    currentPdfScale = Math.min(4.0, Math.max(0.5, currentPdfScale + direction * 0.2));
    currentFontSize = Math.round((currentPdfScale / 1.5) * 100);
    UI.updateFontSizeLabel(currentFontSize);
    renderPdfPage(currentPdfPage);

  } else if (readerType === 'txt') {
    currentFontSize = Math.min(max, Math.max(min, currentFontSize + direction * step));
    UI.updateFontSizeLabel(currentFontSize);
    const el = document.getElementById('txt-pages');
    if (el) el.style.fontSize = currentFontSize + '%';
    relayoutTxtKeepingPosition();
  }
}

// ── 阅读设置：底色 / 翻页动画 ────────────────────────────────────────────────

function applyReaderTheme(theme) {
  readerTheme = theme;
  document.body.classList.remove('theme-original', 'theme-sepia', 'theme-green');
  document.body.classList.add(`theme-${theme}`);
  document.querySelectorAll('.theme-dot').forEach(btn => {
    btn.classList.toggle('theme-active', btn.dataset.theme === theme);
  });
}

document.querySelectorAll('.theme-dot').forEach(btn => {
  btn.addEventListener('click', () => applyReaderTheme(btn.dataset.theme));
});

document.getElementById('turn-mode-select').addEventListener('change', (e) => {
  pageTurnMode = e.target.value === 'instant' ? 'instant' : 'slide';
});

applyReaderTheme(readerTheme);

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
