// Service worker: stores what the page grabber downloads, since content
// scripts cannot open the extension's IndexedDB themselves, and runs the
// scheduled checks for new chapters.
import { getNovel, novelIdFor, saveNovel, saveChapter, savedKeys } from './lib/db.js';
import { checkForUpdates, refreshBadge, scheduleChecks } from './lib/updates.js';

const handlers = {
  async saveNovel({ novel }) {
    const id = novel.id || novelIdFor(novel.host, novel.title);
    const { fallbackUrl, ...fields } = novel;
    if (fallbackUrl && !(await getNovel(id))?.url) fields.url = fallbackUrl;
    return { novel: await saveNovel({ ...fields, id }) };
  },
  async savedKeys({ novelId }) {
    return { keys: await savedKeys(novelId) };
  },
  async saveChapter({ novelId, chapter }) {
    const saved = await saveChapter(novelId, chapter);
    return { id: saved.id };
  },
  async checkNow({ novelIds }) {
    // Answer at once; the library follows progress through storage.
    checkForUpdates(novelIds).catch(() => {});
    return { started: true };
  },
  async refreshBadge() {
    await refreshBadge();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return;
  handler(msg).then(reply, e => reply({ error: e.message }));
  return true;
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'check-updates') checkForUpdates().catch(() => {});
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) {
    const before = changes.settings.oldValue?.checkHours;
    const after = changes.settings.newValue?.checkHours;
    if (before !== after) scheduleChecks();
  }
});

chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'library', title: 'افتح مكتبة LNReader', contexts: ['action'] });
  chrome.storage.local.set({ updateState: { running: false } });
  scheduleChecks();
  refreshBadge();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.set({ updateState: { running: false } });
  refreshBadge();
});

chrome.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === 'library') chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
});
