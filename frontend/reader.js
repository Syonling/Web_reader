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
let epubDirection    = 'horizontal'; // 'horizontal' | 'vertical'
let epubTocOpen      = false;
let epubPageNum      = 0;            // 当前章节内页码（仅用于显示）
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
  epubPageNum      = 0;
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

  // overflow:hidden 已禁止滚动条，无需拦截 wheel 事件

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
  const contentEl = document.getElementById('epub-content');
  if (!contentEl) return;

  // 渲染前隐藏，避免短暂闪现错误位置的内容
  contentEl.style.cssText = 'opacity:0; font-size:' + currentFontSize + '%;';
  contentEl.innerHTML = '';
  Renderer.render(chapter, contentEl);

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

// ─── 布局初始化（字体变化 / 方向切换 / 窗口尺寸变化后调用）──────────────────────
//
// 两种模式均使用：column-width = cW（视口宽），高度 = cH（视口高）
// 每页恰好一列，列向右延伸，translateX(-page * cW) 翻页。
// 视口尺寸来自 epub-scroll（已 inset 内缩提供视觉页边距）。
//
// 用 getBoundingClientRect() + Math.floor() 取整像素，防止亚像素溢出。

function initEpubLayout(resetToStart = true) {
  requestAnimationFrame(() => {
    const scrollEl  = document.getElementById('epub-scroll');
    const contentEl = document.getElementById('epub-content');
    if (!scrollEl || !contentEl) return;

    const rect = scrollEl.getBoundingClientRect();
    const cH   = Math.floor(rect.height);
    const cW   = Math.floor(rect.width);

    contentEl.style.height      = cH + 'px';
    contentEl.style.columnWidth = cW + 'px';
    contentEl.style.columnGap   = '0px';
    contentEl.style.columnFill  = 'auto';

    // 等浏览器多列回流完成后，读取 scrollWidth 并定位
    requestAnimationFrame(() => {
      const el = document.getElementById('epub-content');
      if (!el) return;

      if (resetToStart) epubPageNum = 0;
      el.style.transform = `translateX(${-epubPageNum * cW}px)`;
      el.style.opacity   = '1';
      updateEpubNav();
    });
  });
}

function updateEpubNav() {
  const scrollEl  = document.getElementById('epub-scroll');
  const contentEl = document.getElementById('epub-content');

  let pageStr = '';
  if (scrollEl && contentEl && contentEl.scrollWidth > 0) {
    const cW    = Math.floor(scrollEl.getBoundingClientRect().width);
    const total = Math.max(1, Math.ceil(contentEl.scrollWidth / cW));
    pageStr = `  [${epubPageNum + 1} / ${total}]`;
  }

  const info  = epubChapterList[epubCurrentIndex];
  const title = info?.title ? `  ${info.title}` : '';
  document.getElementById('page-info').textContent =
    `${epubCurrentIndex + 1} / ${epubChapterList.length}${title}${pageStr}`;
  document.getElementById('prev-btn').disabled = false;
  document.getElementById('next-btn').disabled = false;
}

// ─── 章节内翻页（transform 瞬切，无滚动动画）────────────────────────────────────
//
// 横排与竖排统一公式：translateX(-page * cW)
// 竖排使用 writing-mode: vertical-lr，列向右溢出，公式与横排相同。

function epubPageNext() {
  const scrollEl  = document.getElementById('epub-scroll');
  const contentEl = document.getElementById('epub-content');
  if (!scrollEl || !contentEl) return;

  const cW      = Math.floor(scrollEl.getBoundingClientRect().width);
  const maxPage = Math.max(0, Math.ceil(contentEl.scrollWidth / cW) - 1);

  if (epubPageNum >= maxPage) {
    if (epubCurrentIndex < epubChapterList.length - 1)
      renderEpubChapter(epubCurrentIndex + 1);
    return;
  }

  epubPageNum++;
  contentEl.style.transform = `translateX(${-epubPageNum * cW}px)`;
  updateEpubNav();
}

function epubPagePrev() {
  const scrollEl  = document.getElementById('epub-scroll');
  const contentEl = document.getElementById('epub-content');
  if (!scrollEl || !contentEl) return;

  if (epubPageNum <= 0) {
    if (epubCurrentIndex > 0)
      renderEpubChapter(epubCurrentIndex - 1);
    return;
  }

  const cW = Math.floor(scrollEl.getBoundingClientRect().width);
  epubPageNum--;
  contentEl.style.transform = `translateX(${-epubPageNum * cW}px)`;
  updateEpubNav();
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
  const next = e.key === 'ArrowRight' || e.key === 'ArrowDown';
  const prev = e.key === 'ArrowLeft'  || e.key === 'ArrowUp';
  if (!next && !prev) return;

  if (readerType === 'epub') {
    next ? epubPageNext() : epubPagePrev();
  } else if (readerType === 'pdf') {
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
