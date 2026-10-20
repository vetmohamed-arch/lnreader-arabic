// Offline library kept in the extension's IndexedDB. Every extension page and
// the service worker share it; content scripts reach it through messages.
//
// novels:   { id, title, author, cover, summary, source, url, host,
//             createdAt, updatedAt, lastRead: { chapterId, scroll } }
// chapters: { id, novelId, order, key, title, url, paragraphs: [{ t, x }],
//             translations: { ar: { title, paragraphs, glossary } }, savedAt }
//   t is 'p' for a paragraph or 'h' for a heading, x is plain text.

const DB_NAME = 'lnreader-web';
const DB_VERSION = 1;

let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('novels')) {
          db.createObjectStore('novels', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('chapters')) {
          const store = db.createObjectStore('chapters', { keyPath: 'id' });
          store.createIndex('novelId', 'novelId');
          store.createIndex('order', ['novelId', 'order']);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export function novelIdFor(host, title) {
  const slug = String(title || 'novel')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return `${host || 'local'}::${slug}`;
}

export async function getNovel(id) {
  return wrap((await store('novels')).get(id));
}

export async function listNovels() {
  const novels = await wrap((await store('novels')).getAll());
  return novels.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Creates the novel or merges the new fields into the saved one. */
export async function saveNovel(novel) {
  const old = (await getNovel(novel.id)) || { createdAt: Date.now() };
  const merged = { ...old };
  for (const [k, v] of Object.entries(novel)) {
    if (v !== undefined && v !== null && v !== '') merged[k] = v;
  }
  merged.updatedAt = Date.now();
  await wrap((await store('novels', 'readwrite')).put(merged));
  return merged;
}

export async function updateNovel(id, fields) {
  const novel = await getNovel(id);
  if (!novel) return undefined;
  Object.assign(novel, fields);
  await wrap((await store('novels', 'readwrite')).put(novel));
  return novel;
}

export async function deleteNovel(id) {
  const chapters = await listChapters(id);
  const s = await store('chapters', 'readwrite');
  await Promise.all(chapters.map(c => wrap(s.delete(c.id))));
  await wrap((await store('novels', 'readwrite')).delete(id));
}

/** Chapters of a novel in reading order, without loading other novels. */
export async function listChapters(novelId) {
  const index = (await store('chapters')).index('novelId');
  const chapters = await wrap(index.getAll(novelId));
  return chapters.sort((a, b) => a.order - b.order);
}

/** Chapter ids in reading order, without loading their text. */
export async function chapterIds(novelId) {
  const index = (await store('chapters')).index('order');
  return wrap(index.getAllKeys(IDBKeyRange.bound([novelId, -Infinity], [novelId, Infinity])));
}

export async function getChapter(id) {
  return wrap((await store('chapters')).get(id));
}

export function chapterIdFor(novelId, key) {
  return `${novelId}::${key}`;
}

/**
 * Saves a downloaded chapter. `order` may be omitted to append it after the
 * last saved chapter; re-downloading the same key replaces the text but keeps
 * its place and translations of unchanged text.
 */
export async function saveChapter(novelId, chapter) {
  const id = chapterIdFor(novelId, chapter.key || chapter.url);
  const old = await getChapter(id);
  let order = chapter.order;
  if (order === undefined || order === null) {
    if (old) order = old.order;
    else {
      const all = await listChapters(novelId);
      order = all.length ? all[all.length - 1].order + 1 : 1;
    }
  }
  const sameText =
    old && JSON.stringify(old.paragraphs) === JSON.stringify(chapter.paragraphs);
  const record = {
    id,
    novelId,
    order,
    key: chapter.key || chapter.url,
    title: chapter.title || `Chapter ${order}`,
    url: chapter.url || '',
    paragraphs: chapter.paragraphs || [],
    translations: sameText ? old.translations || {} : {},
    savedAt: Date.now(),
  };
  await wrap((await store('chapters', 'readwrite')).put(record));
  await updateNovel(novelId, { updatedAt: Date.now() });
  return record;
}

export async function putChapter(record) {
  await wrap((await store('chapters', 'readwrite')).put(record));
  return record;
}

export async function deleteChapter(id) {
  await wrap((await store('chapters', 'readwrite')).delete(id));
}

/** Keys of the chapters already saved, so downloads can skip them. */
export async function savedKeys(novelId) {
  const chapters = await listChapters(novelId);
  return chapters.map(c => c.key);
}

export async function chapterCounts() {
  const all = await wrap((await store('chapters')).getAllKeys());
  const counts = {};
  for (const id of all) {
    const novelId = String(id).split('::').slice(0, 2).join('::');
    counts[novelId] = (counts[novelId] || 0) + 1;
  }
  return counts;
}
