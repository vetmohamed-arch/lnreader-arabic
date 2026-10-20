// Service worker: stores what the page grabber downloads, since content
// scripts cannot open the extension's IndexedDB themselves.
import { novelIdFor, saveNovel, saveChapter, savedKeys } from './lib/db.js';

const handlers = {
  async saveNovel({ novel }) {
    const id = novel.id || novelIdFor(novel.host, novel.title);
    return { novel: await saveNovel({ ...novel, id }) };
  },
  async savedKeys({ novelId }) {
    return { keys: await savedKeys(novelId) };
  },
  async saveChapter({ novelId, chapter }) {
    const saved = await saveChapter(novelId, chapter);
    return { id: saved.id };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return;
  handler(msg).then(reply, e => reply({ error: e.message }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'library', title: 'افتح مكتبة LNReader', contexts: ['action'] });
});

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'library') chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
});
