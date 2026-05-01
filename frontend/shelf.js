/**
 * shelf.js — 书架页逻辑
 *
 * 数据层：
 *   IndexedDB（BookDB）  —— 文件、封面、元数据，本地持久化
 *   library_backend:5002 —— 元数据、进度镜像（可选，后端离线不影响使用）
 */

// ─── 封面颜色池（无封面时随机取色）──────────────────────────────────────────

const COVER_COLORS = [
  '#4a6fa5', '#7b5ea7', '#5a8a6a', '#a05c5c',
  '#7a6a4a', '#3d7a8a', '#8a6a3d', '#5a6a8a',
];

function coverColor(bookId) {
  let hash = 0;
  for (const ch of bookId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return COVER_COLORS[Math.abs(hash) % COVER_COLORS.length];
}

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

async function generateBookId(file) {
  const data = new TextEncoder().encode(file.name + '|' + file.size);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 12)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('FileReader 失败'));
    reader.readAsDataURL(blob);
  });
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── 封面提取 ─────────────────────────────────────────────────────────────────

async function extractEpubCover(buffer) {
  try {
    const info = await readEpubPackageInfo(buffer);
    if (!info?.coverBlob) return null;
    return blobToDataUrl(info.coverBlob);
  } catch { return null; }
}

async function readEpubPackageInfo(buffer) {
  if (typeof JSZip === 'undefined') return null;

  const zip = await JSZip.loadAsync(buffer.slice(0));
  const containerEntry = zip.file('META-INF/container.xml');
  if (!containerEntry) return null;

  const containerText = await containerEntry.async('string');
  const containerDoc = new DOMParser().parseFromString(containerText, 'application/xml');
  const rootfileEl = findFirstElementByLocalName(containerDoc, 'rootfile');
  const opfPath = rootfileEl?.getAttribute('full-path');
  if (!opfPath) return null;

  const opfEntry = zip.file(opfPath);
  if (!opfEntry) return null;

  const opfText = await opfEntry.async('string');
  const opfDoc = new DOMParser().parseFromString(opfText, 'application/xml');
  const manifest = [...opfDoc.getElementsByTagName('*')].filter(el => el.localName === 'item');

  const title = findFirstElementByLocalName(opfDoc, 'title')?.textContent?.trim() || null;
  const coverId = findCoverItemId(opfDoc);
  const coverItem = manifest.find(item =>
    (coverId && item.getAttribute('id') === coverId) ||
    ((item.getAttribute('properties') || '').split(/\s+/).includes('cover-image'))
  );

  let coverBlob = null;
  if (coverItem) {
    const href = coverItem.getAttribute('href');
    const coverPath = href ? resolveRelativeZipPath(opfPath, href) : null;
    const coverEntry = coverPath ? zip.file(coverPath) : null;
    if (coverEntry) coverBlob = await coverEntry.async('blob');
  }

  return { title, coverBlob };
}

function findFirstElementByLocalName(root, localName) {
  return [...root.getElementsByTagName('*')].find(el => el.localName === localName) || null;
}

function findCoverItemId(opfDoc) {
  const metaEls = [...opfDoc.getElementsByTagName('*')].filter(el => el.localName === 'meta');
  const coverMeta = metaEls.find(el => (el.getAttribute('name') || '').toLowerCase() === 'cover');
  return coverMeta?.getAttribute('content') || null;
}

function resolveRelativeZipPath(baseFilePath, relativePath) {
  const baseParts = baseFilePath.split('/');
  baseParts.pop();
  const relParts = relativePath.split('/');
  const parts = [...baseParts];

  for (const part of relParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.join('/');
}

async function extractPdfCover(buffer) {
  if (typeof pdfjsLib === 'undefined') return null;
  try {
    const pdf = await pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: 0.5 });
    const canvas = document.createElement('canvas');
    canvas.width  = vp.width;
    canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    pdf.destroy();
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch { return null; }
}

// ─── 添加书籍 ─────────────────────────────────────────────────────────────────

async function addBook(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['epub', 'pdf', 'txt'].includes(ext)) {
    alert(`不支持 .${ext.toUpperCase()} 格式。\n支持：EPUB、PDF、TXT`);
    return;
  }

  const bookId = await generateBookId(file);

  // 已存在则直接跳转
  const existing = await BookDB.getMeta(bookId);
  if (existing) {
    window.location.href = `reader.html?id=${encodeURIComponent(bookId)}`;
    return;
  }

  // 读取文件内容
  const buffer = await file.arrayBuffer();

  // 显示占位卡片
  renderAddingPlaceholder(bookId, file.name);

  // 提取标题
  let title = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'epub') {
    try {
      const info = await readEpubPackageInfo(buffer);
      if (info?.title) title = info.title;
    } catch {}
  }

  const meta = { title, fileName: file.name, format: ext, fileSize: file.size };

  // 并行：存文件 + 提取封面 + 通知后端
  const [, coverDataUrl] = await Promise.all([
    BookDB.saveFile(bookId, buffer),
    ext === 'epub' ? extractEpubCover(buffer)
                   : ext === 'pdf' ? extractPdfCover(buffer) : Promise.resolve(null),
    BookDB.saveMeta(bookId, meta),
    LibraryAPI.addBook({
      id: bookId,
      title,
      file_name: file.name,
      file_size: file.size,
      format: ext,
    }).catch(() => {}),
  ]);

  if (coverDataUrl) await BookDB.saveCover(bookId, coverDataUrl);

  // 刷新书架
  await loadShelf();
}

// ─── 渲染 ─────────────────────────────────────────────────────────────────────

function renderAddingPlaceholder(bookId, fileName) {
  const grid = document.getElementById('shelf-grid');
  const addCard = grid.querySelector('.book-add-card');

  const card = document.createElement('div');
  card.className = 'book-card';
  card.dataset.id = bookId;

  card.innerHTML = `
    <div class="book-cover-wrap cover-loading" style="aspect-ratio:2/3"></div>
    <div class="book-info">
      <div class="book-title-label" style="color:var(--color-text-muted)">
        ${escapeHtml(fileName.replace(/\.[^.]+$/, '').slice(0, 30))}
      </div>
      <div class="book-progress-label">正在处理…</div>
    </div>`;

  grid.insertBefore(card, addCard);
}

function buildCoverEl(coverDataUrl, bookId, title) {
  const wrap = document.createElement('div');
  wrap.className = 'book-cover-wrap';

  if (coverDataUrl) {
    const img = document.createElement('img');
    img.src = coverDataUrl;
    img.alt = title;
    img.loading = 'lazy';
    wrap.appendChild(img);
  } else {
    wrap.style.background = coverColor(bookId);
    const ph = document.createElement('div');
    ph.className = 'book-cover-placeholder';
    const txt = document.createElement('div');
    txt.className = 'book-cover-placeholder-text';
    txt.textContent = title.slice(0, 20);
    ph.appendChild(txt);
    wrap.appendChild(ph);
  }

  return wrap;
}

function buildBookCard(book, coverDataUrl, progress) {
  const card = document.createElement('div');
  card.className = 'book-card';
  card.dataset.id = book.id;

  const coverEl = buildCoverEl(coverDataUrl, book.id, book.title);
  card.appendChild(coverEl);

  // 删除按钮（覆盖在封面上）
  const delBtn = document.createElement('button');
  delBtn.className = 'book-delete-btn';
  delBtn.textContent = '✕';
  delBtn.title = '从书架移除';
  delBtn.addEventListener('click', e => {
    e.stopPropagation();
    confirmDeleteBook(book.id, book.title);
  });
  card.appendChild(delBtn);

  const info = document.createElement('div');
  info.className = 'book-info';

  const titleEl = document.createElement('div');
  titleEl.className = 'book-title-label';
  titleEl.title = book.title;
  titleEl.textContent = book.title;

  const progEl = document.createElement('div');
  progEl.className = 'book-progress-label';
  if (progress && progress.chapter_index > 0) {
    progEl.textContent = `第 ${progress.chapter_index + 1} 章`;
  } else {
    progEl.textContent = book.format?.toUpperCase() || 'EPUB';
  }

  info.appendChild(titleEl);
  info.appendChild(progEl);
  card.appendChild(info);

  card.addEventListener('click', () => {
    window.location.href = `reader.html?id=${encodeURIComponent(book.id)}`;
  });

  return card;
}

function buildAddCard() {
  const card = document.createElement('div');
  card.className = 'book-add-card';
  card.innerHTML = '<div class="add-icon">＋</div><div class="add-label">添加书籍</div>';
  card.addEventListener('click', () => document.getElementById('file-input').click());
  return card;
}

// ─── 加载书架 ─────────────────────────────────────────────────────────────────

async function loadShelf() {
  const grid = document.getElementById('shelf-grid');
  grid.innerHTML = '';

  // 从 IndexedDB 读取本地元数据（不依赖后端）
  const localBooks = await BookDB.listMeta();

  if (!localBooks.length) {
    const empty = document.createElement('div');
    empty.className = 'shelf-empty';
    empty.innerHTML = '书架还是空的<br><span style="font-size:13px">点击右侧 ＋ 添加第一本书</span>';
    grid.appendChild(empty);
    grid.appendChild(buildAddCard());
    return;
  }

  // 并行获取封面 + 进度
  const items = await Promise.all(localBooks.map(async book => {
    const [cover, progress] = await Promise.all([
      BookDB.getCover(book.id),
      LibraryAPI.getProgress(book.id).catch(() => null),
    ]);
    return { book, cover, progress };
  }));

  // 按最近打开排序（IndexedDB 无时间戳时按添加顺序）
  const frag = document.createDocumentFragment();
  for (const { book, cover, progress } of items) {
    frag.appendChild(buildBookCard(book, cover, progress));
  }
  frag.appendChild(buildAddCard());
  grid.appendChild(frag);
}

// ─── 删除书籍 ─────────────────────────────────────────────────────────────────

let pendingDeleteId = null;

function confirmDeleteBook(bookId, title) {
  pendingDeleteId = bookId;
  document.getElementById('delete-modal-title').textContent = '从书架移除';
  document.getElementById('delete-modal-body').textContent =
    `确定要移除《${title}》吗？本地文件数据将一并删除。`;
  document.getElementById('delete-overlay').classList.remove('hidden');
}

async function executeDeleteBook() {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  pendingDeleteId = null;
  document.getElementById('delete-overlay').classList.add('hidden');

  await Promise.all([
    BookDB.deleteBook(id),
    LibraryAPI.deleteBook(id).catch(() => {}),
  ]);

  await loadShelf();
}

document.getElementById('delete-confirm-btn').addEventListener('click', executeDeleteBook);
document.getElementById('delete-cancel').addEventListener('click', () => {
  pendingDeleteId = null;
  document.getElementById('delete-overlay').classList.add('hidden');
});
document.getElementById('delete-cancel-btn').addEventListener('click', () => {
  pendingDeleteId = null;
  document.getElementById('delete-overlay').classList.add('hidden');
});

// ─── 文件输入 ─────────────────────────────────────────────────────────────────

document.getElementById('file-input').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await addBook(file);
});

// ─── 书架后端状态 ─────────────────────────────────────────────────────────────

async function checkLibraryStatus() {
  const dot = document.getElementById('library-status');
  try {
    const res = await fetch(`${CONFIG.LIBRARY_BASE_URL}/api/health`);
    dot.className = 'library-status ' + (res.ok ? 'online' : 'offline');
    dot.title = res.ok ? '书架后端已连接' : '书架后端连接失败';
  } catch {
    dot.className = 'library-status offline';
    dot.title = '书架后端未连接（进度不会同步）';
  }
}

// ─── 初始化 ───────────────────────────────────────────────────────────────────

checkLibraryStatus();
loadShelf();
