// Looks for new chapters of followed novels, downloads them and (optionally)
// translates them. Runs in the service worker. Each novel's page is opened in
// a minimized window so the site's cookies, login and security check apply,
// exactly as when the reader downloads by hand.
import { listNovels, listChapters, getNovel, getChapter, putChapter, updateNovel } from './db.js';
import { getSettings } from './settings.js';
import { translateChapter } from './translate.js';

let running = null;

export function isFollowed(n) {
  return n.follow !== false && n.source !== 'file';
}

async function setState(patch) {
  const { updateState } = await chrome.storage.local.get('updateState');
  await chrome.storage.local.set({ updateState: { ...(updateState || {}), ...patch } });
}

export async function refreshBadge() {
  const novels = await listNovels();
  const total = novels.reduce((s, n) => s + (n.newCount || 0), 0);
  await chrome.action.setBadgeBackgroundColor({ color: '#b5651d' });
  await chrome.action.setBadgeText({ text: total ? String(total > 999 ? '999+' : total) : '' });
}

export async function scheduleChecks() {
  const { checkHours } = await getSettings();
  await chrome.alarms.clear('check-updates');
  if (checkHours > 0) {
    chrome.alarms.create('check-updates', { delayInMinutes: 2, periodInMinutes: checkHours * 60 });
  }
}

function waitForLoad(tabId, timeout = 45000) {
  return new Promise(resolve => {
    const done = () => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      // Give scripts on the page a moment (and a security check time to pass).
      setTimeout(resolve, 1500);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') done();
    };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function openIn(tabId, url) {
  await chrome.tabs.update(tabId, { url });
  await waitForLoad(tabId);
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content/grabber.js'] });
}

const ask = (tabId, cmd, opts) => chrome.tabs.sendMessage(tabId, { to: 'grabber', cmd, opts });

/** Downloads what is new for one novel; returns the new chapter ids. */
async function updateNovelChapters(tabId, novel) {
  const tocUrl = novel.tocUrl || (novel.source === 'fictionzone' ? novel.url : '');
  let res;
  if (tocUrl) {
    await openIn(tabId, tocUrl);
    const info = await ask(tabId, 'analyze');
    if (!info || info.error) throw new Error(info?.error || 'الصفحة ما ردتش');
    res = await ask(tabId, 'run', { mode: 'toc', afterSaved: true, expand: !!info.tocPaged, novelId: novel.id, novelTitle: novel.title });
  } else {
    // Downloaded from chapter pages: start at the newest saved chapter and follow "next".
    const chapters = await listChapters(novel.id);
    const last = chapters.at(-1);
    if (!last?.url || !/^https?:/.test(last.url)) return [];
    await openIn(tabId, last.url);
    res = await ask(tabId, 'run', { mode: 'next', count: 200, skipSaved: true, novelId: novel.id, novelTitle: novel.title });
  }
  if (!res || res.error) throw new Error(res?.error || 'التحميل ما كملش');
  return res.ids || [];
}

async function translateNew(novel, ids, settings) {
  for (const id of ids) {
    const ch = await getChapter(id);
    if (!ch || ch.translations?.[settings.targetLang]) continue;
    ch.translations = { ...(ch.translations || {}), [settings.targetLang]: await translateChapter(ch, { ...settings, novelGlossary: novel.glossary }) };
    await putChapter(ch);
  }
}

async function openWorkTab() {
  try {
    const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false });
    return { tabId: win.tabs[0].id, close: () => chrome.windows.remove(win.id).catch(() => {}) };
  } catch {
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    return { tabId: tab.id, close: () => chrome.tabs.remove(tab.id).catch(() => {}) };
  }
}

/**
 * Checks the given novels (default: every followed one). Only one check runs
 * at a time; a second call gets the running one's result.
 */
export function checkForUpdates(novelIds) {
  if (!running) running = runCheck(novelIds).finally(() => (running = null));
  return running;
}

async function runCheck(novelIds) {
  const settings = await getSettings();
  const all = await listNovels();
  const novels = all.filter(n => (novelIds ? novelIds.includes(n.id) : isFollowed(n)));
  const results = [];
  if (!novels.length) {
    await setState({ running: false, lastCheck: Date.now(), results });
    return results;
  }
  const work = await openWorkTab();
  try {
    for (const [i, novel] of novels.entries()) {
      await setState({ running: true, current: novel.title, progress: `${i + 1}/${novels.length}` });
      const result = { id: novel.id, title: novel.title, found: 0 };
      try {
        const ids = await updateNovelChapters(work.tabId, novel);
        result.found = ids.length;
        if (ids.length && settings.autoTranslateNew) {
          try {
            await translateNew(novel, ids, settings);
          } catch (e) {
            result.error = `اتحمّلت بس الترجمة وقفت: ${e.message}`;
          }
        }
        const fresh = await getNovel(novel.id);
        await updateNovel(novel.id, { newCount: (fresh.newCount || 0) + ids.length, lastCheck: Date.now(), lastError: result.error || '' });
      } catch (e) {
        result.error = e.message;
        await updateNovel(novel.id, { lastCheck: Date.now(), lastError: e.message });
      }
      results.push(result);
    }
  } finally {
    await work.close();
  }
  await setState({ running: false, current: '', progress: '', lastCheck: Date.now(), results });
  await refreshBadge();
  const found = results.filter(r => r.found);
  if (found.length && settings.notify) {
    const total = found.reduce((s, r) => s + r.found, 0);
    chrome.notifications.create('new-chapters', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: `${total} فصل جديد`,
      message: found.map(r => `${r.title}: ${r.found}`).join('\n'),
    });
  }
  return results;
}
