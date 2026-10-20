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
  // Fiction Zone keeps its login where page scripts of the grabber can't see
  // it: an httpOnly cookie, or the Nuxt app's own state.
  async fzToken(_msg, sender) {
    const cookies = await chrome.cookies.getAll({ domain: 'fictionzone.net' }).catch(() => []);
    for (const c of cookies.sort((a, b) => (TOKEN_NAME.test(b.name) ? 1 : 0) - (TOKEN_NAME.test(a.name) ? 1 : 0))) {
      const t = tokenIn(c.name, c.value);
      if (t) return { token: t };
    }
    if (sender.tab?.id === undefined) return { token: null };
    const [res] = await chrome.scripting
      .executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: pageToken })
      .catch(() => []);
    return { token: res?.result || null };
  },
};

const TOKEN_NAME = /token|auth|jwt|session/i;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

function tokenIn(name, value) {
  let v = value || '';
  try {
    v = decodeURIComponent(v);
  } catch {}
  const m = v.match(JWT);
  if (m) return m[0];
  if (/^(access_?token|auth_?token|token|jwt)$/i.test(name) && v.length > 20) return v.replace(/^Bearer\s+/i, '');
  return null;
}

/** Runs in the page itself: looks through the Nuxt/Pinia state for the login. */
function pageToken() {
  const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
  const seen = new WeakSet();
  function find(value, depth) {
    if (value === null || value === undefined || depth > 6) return undefined;
    if (typeof value === 'string') return value.match(JWT)?.[0];
    if (typeof value !== 'object' || seen.has(value)) return undefined;
    seen.add(value);
    let keys;
    try {
      keys = Object.keys(value);
    } catch {
      return undefined;
    }
    keys.sort((a, b) => (/token|auth|session|user/i.test(a) ? 0 : 1) - (/token|auth|session|user/i.test(b) ? 0 : 1));
    for (const k of keys.slice(0, 300)) {
      let v;
      try {
        v = value[k];
      } catch {
        continue;
      }
      if (/^(access_?token|auth_?token|token|jwt)$/i.test(k) && typeof v === 'string' && v.length > 20) return v.replace(/^Bearer\s+/i, '');
      const f = find(v, depth + 1);
      if (f) return f;
    }
    return undefined;
  }
  const app = document.querySelector('#__nuxt')?.__vue_app__;
  const props = app?.config?.globalProperties || {};
  return (
    find(props.$pinia?.state?.value, 0) ||
    find(props.$nuxt?.payload?.state, 0) ||
    find(window.__NUXT__, 0) ||
    find(props.$auth, 0) ||
    null
  );
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return;
  handler(msg, sender).then(reply, e => reply({ error: e.message }));
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
