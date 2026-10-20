const $ = id => document.getElementById(id);

const params = new URLSearchParams(location.search);
let tabId;
let info;

function showError(text) {
  $('error').textContent = text;
  $('error').hidden = false;
}

function ask(cmd, opts) {
  return chrome.tabs.sendMessage(tabId, { to: 'grabber', cmd, opts });
}

async function currentTab() {
  if (params.get('tab')) return { id: Number(params.get('tab')), url: 'http://test/' };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showRunning(state) {
  $('running').hidden = !state;
  if (state) $('runningText').textContent = state.text || 'بيحمّل...';
}

function render() {
  $('status').hidden = true;
  $('main').hidden = false;
  $('title').value = info.novel?.title || '';
  $('source').textContent = info.novel?.host || '';
  showRunning(info.running);

  const chapters = info.chapters || [];
  // A chapter page often lists a few related chapters; only offer a real list.
  if (chapters.length && (info.kind !== 'chapter' || chapters.length >= 10)) {
    $('tocBox').hidden = false;
    $('tocInfo').textContent = `لقيت فهرس فيه ${chapters.length} فصل (من «${chapters[0].title}» لـ «${chapters.at(-1).title}»).`;
    $('to').value = chapters.length;
    $('from').max = $('to').max = chapters.length;
    $('expandRow').hidden = !info.tocPaged;
  } else if (info.needsLogin) {
    $('tocBox').hidden = false;
    $('tocInfo').textContent = 'الرواية دي من Omniportal وفصولها محتاجة تسجيل دخول في فيكشن زون. سجّل دخول في الموقع وافتح الإضافة تاني.';
    $('getToc').disabled = true;
  }

  if (info.kind === 'chapter') {
    $('chapterBox').hidden = false;
    $('chapterTitle').textContent = info.current.title || '(من غير عنوان)';
    $('noNext').hidden = !!info.current.next;
    if (!info.current.next) $('count').value = 1;
  }

  if (info.kind === 'unknown' && !chapters.length) {
    $('status').hidden = false;
    $('status').textContent = 'ما لقيتش فصل ولا فهرس فصول في الصفحة دي. افتح صفحة الرواية (اللي فيها قايمة الفصول) أو أي فصل.';
  }

  const files = info.files || [];
  $('filesBox').hidden = !files.length;
  $('files').replaceChildren(
    ...files.map(f => {
      const row = document.createElement('div');
      row.className = 'row';
      const ext = document.createElement('span');
      ext.className = 'ext';
      ext.textContent = f.ext;
      const name = document.createElement('span');
      name.className = 'name grow';
      name.textContent = f.name;
      name.title = f.url;
      const btn = document.createElement('button');
      btn.textContent = 'نزّل';
      btn.onclick = async () => {
        try {
          await chrome.downloads.download({ url: f.url });
          btn.textContent = '✓';
        } catch (e) {
          showError(e.message);
        }
      };
      row.append(ext, name, btn);
      return row;
    }),
  );
}

async function start(opts) {
  $('error').hidden = true;
  const res = await ask('start', { ...opts, novelTitle: $('title').value.trim() });
  if (res?.error) return showError(res.error);
  showRunning({ text: 'بدأ التحميل. تقدر تقفل النافذة دي، والتحميل هيكمل طول ما تاب الموقع مفتوح.' });
}

$('getToc').onclick = () =>
  start({
    mode: 'toc',
    from: Number($('from').value) || 1,
    to: Number($('to').value) || undefined,
    skipSaved: $('skip').checked,
    expand: info.tocPaged && $('expand').checked,
  });
$('getNext').onclick = () => start({ mode: 'next', count: Number($('count').value) || 1, skipSaved: false });
$('getOne').onclick = () => start({ mode: 'next', count: 1, skipSaved: false });
$('stop').onclick = async () => {
  await ask('cancel');
  $('runningText').textContent = 'بيوقف...';
};
$('library').onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
  window.close();
};

(async () => {
  try {
    const tab = await currentTab();
    tabId = tab.id;
    if (!/^https?:/.test(tab.url || '')) {
      $('status').textContent = 'افتح صفحة رواية على أي موقع، وبعدين دوس على الإضافة.';
      return;
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/grabber.js'] });
    info = await ask('analyze');
    if (!info || info.error) throw new Error(info?.error || 'الصفحة ما ردتش');
    render();
    // Keep the progress line fresh while a download runs.
    setInterval(async () => {
      const s = await ask('status').catch(() => null);
      if (s) showRunning(s.running);
    }, 1000);
  } catch (e) {
    $('status').hidden = true;
    showError(`مقدرتش أقرا الصفحة: ${e.message}`);
  }
})();
