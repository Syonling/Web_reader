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
  chapterCache.clear();

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

  // 主文档选区监听（内容在主文档，无需 iframe 注入）
  document.addEventListener('mouseup', onMainDocMouseUp);

  // 竖/横排切换按钮
  const dirBtn = document.getElementById('direction-btn');
  dirBtn.hidden = false;
  dirBtn.textContent = epubDirection === 'horizontal' ? '竖排' : '横排';

  document.getElementById('prev-btn').textContent = '← 上一章';
  document.getElementById('next-btn').textContent = '下一章 →';
  UI.showNavigation();

  await renderEpubChapter(0);
}

async function renderEpubChapter(index) {
  if (index < 0 || index >= epubChapterList.length) return;
  epubCurrentIndex = index;

  const chapter   = await getEpubChapter(index);
  const contentEl = document.getElementById('epub-content');
  if (!contentEl) return;

  contentEl.innerHTML = '';
  Renderer.render(chapter, contentEl);

  // 跳转到章节开头
  const scrollEl = document.getElementById('epub-scroll');
  if (scrollEl) {
    scrollEl.scrollTop  = 0;
    // 竖排：章节开头在右侧，滚到最右端
    scrollEl.scrollLeft = epubDirection === 'vertical' ? scrollEl.scrollWidth : 0;
  }

  updateEpubNav();

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

function updateEpubNav() {
  const total = epubChapterList.length;
  const cur   = epubCurrentIndex;
  const info  = epubChapterList[cur];

  const label = `${cur + 1} / ${total}` + (info?.title ? `  ${info.title}` : '');
  document.getElementById('page-info').textContent = label;
  document.getElementById('prev-btn').disabled = cur <= 0;
  document.getElementById('next-btn').disabled = cur >= total - 1;
}

function toggleEpubDirection() {
  epubDirection = epubDirection === 'horizontal' ? 'vertical' : 'horizontal';

  const epubEl = document.getElementById('epub-reader');
  if (epubEl) epubEl.className = `epub-reader layout-${epubDirection}`;

  const dirBtn = document.getElementById('direction-btn');
  if (dirBtn) dirBtn.textContent = epubDirection === 'horizontal' ? '竖排' : '横排';

  // 切换后滚动到章节开头
  const scrollEl = document.getElementById('epub-scroll');
  if (scrollEl) {
    scrollEl.scrollTop  = 0;
    scrollEl.scrollLeft = epubDirection === 'vertical' ? scrollEl.scrollWidth : 0;
  }
}

// ─── 竖/横排切换按钮 ──────────────────────────────────────────────────────────

document.getElementById('direction-btn').addEventListener('click', () => {
  if (readerType === 'epub') toggleEpubDirection();
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

// ── 翻页 / 章节导航 ───────────────────────────────────────────────────────────

document.getElementById('prev-btn').addEventListener('click', () => {
  if (readerType === 'epub') {
    renderEpubChapter(epubCurrentIndex - 1);
    selectedText = '';
    UI.setAnalyzeBtnEnabled(false);
  } else if (readerType === 'pdf') {
    renderPdfPage(currentPdfPage - 1);
  }
});

document.getElementById('next-btn').addEventListener('click', () => {
  if (readerType === 'epub') {
    renderEpubChapter(epubCurrentIndex + 1);
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
    next ? renderEpubChapter(epubCurrentIndex + 1) : renderEpubChapter(epubCurrentIndex - 1);
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
