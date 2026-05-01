/**
 * db.js — IndexedDB 封装
 * 三个对象仓库：book_files（ArrayBuffer）、book_covers（Data URL）、book_meta（元数据对象）
 */
const BookDB = (() => {
  const DB_NAME    = 'eupd-reader-shelf';
  const DB_VERSION = 1;
  const STORES     = ['book_files', 'book_covers', 'book_meta'];

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name))
            db.createObjectStore(name);
        });
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }

  function _put(store, key, value) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    }));
  }

  function _get(store, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    }));
  }

  function _del(store, key) {
    return open().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    }));
  }

  return {
    saveFile:  (id, buf)  => _put('book_files',  id, buf),
    getFile:   id         => _get('book_files',  id),
    saveCover: (id, url)  => _put('book_covers', id, url),
    getCover:  id         => _get('book_covers', id),
    saveMeta:  (id, meta) => _put('book_meta',   id, meta),
    getMeta:   id         => _get('book_meta',   id),

    async deleteBook(id) {
      await Promise.all(STORES.map(s => _del(s, id)));
    },

    // 返回所有已存储的 meta 对象列表
    async listMeta() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const results = [];
        const tx  = db.transaction('book_meta', 'readonly');
        const req = tx.objectStore('book_meta').openCursor();
        req.onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) { results.push({ id: cursor.key, ...cursor.value }); cursor.continue(); }
          else resolve(results);
        };
        req.onerror = e => reject(e.target.error);
      });
    },
  };
})();
