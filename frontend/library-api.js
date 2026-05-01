/**
 * library-api.js — 书架后端 API 调用（端口 5002）
 * 所有调用静默失败不影响阅读主流程。
 */
const LibraryAPI = {
  _base() { return CONFIG.LIBRARY_BASE_URL; },
  _settingsCache: null,
  _error(res) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    return err;
  },

  async addBook({ id, title, file_name, file_size, fileName, fileSize, format }) {
    const normalizedFileName = file_name ?? fileName ?? '';
    const normalizedFileSize = file_size ?? fileSize ?? 0;
    const res = await fetch(`${this._base()}/api/books`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        title,
        file_name: normalizedFileName,
        file_size: normalizedFileSize,
        format,
      }),
    });
    if (!res.ok) throw this._error(res);
    return res.json();
  },

  async getBooks() {
    const res = await fetch(`${this._base()}/api/books`);
    if (!res.ok) throw this._error(res);
    return res.json();
  },

  async deleteBook(id) {
    const res = await fetch(`${this._base()}/api/books/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw this._error(res);
    return res.json();
  },

  async getProgress(bookId) {
    const res = await fetch(`${this._base()}/api/books/${encodeURIComponent(bookId)}/progress`);
    if (!res.ok) throw this._error(res);
    return res.json();
  },

  async saveProgress(bookId, chapterIndex, pageNum) {
    const res = await fetch(`${this._base()}/api/books/${encodeURIComponent(bookId)}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chapter_index: chapterIndex, page_num: pageNum }),
    });
    if (!res.ok) throw this._error(res);
    return res.json();
  },

  async getSettings() {
    const res = await fetch(`${this._base()}/api/settings`);
    if (!res.ok) throw this._error(res);
    this._settingsCache = await res.json();
    return this._settingsCache;
  },

  async saveSettings(settings) {
    const res = await fetch(`${this._base()}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw this._error(res);
    const json = await res.json();
    this._settingsCache = { ...(this._settingsCache || {}), ...settings };
    return json;
  },

  async _ensureSettingsCache() {
    if (!this._settingsCache) {
      this._settingsCache = await this.getSettings().catch(() => ({}));
    }
    return this._settingsCache;
  },

  async getGlobalReaderSettings() {
    const all = await this._ensureSettingsCache();
    return {
      font_size: all.font_size,
      theme: all.theme,
      turn_mode: all.turn_mode,
      ai_provider: all.ai_provider,
    };
  },

  async saveGlobalReaderSettings(settings) {
    await this.saveSettings(settings);
    return settings;
  },

  async getBookReaderSettings(bookId) {
    if (!bookId) return null;
    const all = await this._ensureSettingsCache();
    return all.book_reader_settings?.[bookId] || null;
  },

  async saveBookReaderSettings(bookId, settings) {
    if (!bookId) return null;
    const all = await this._ensureSettingsCache();
    const next = {
      ...(all.book_reader_settings || {}),
      [bookId]: {
        ...((all.book_reader_settings || {})[bookId] || {}),
        ...settings,
      },
    };
    this._settingsCache = {
      ...all,
      book_reader_settings: next,
    };
    await this.saveSettings({ book_reader_settings: next });
    return next[bookId];
  },
};
