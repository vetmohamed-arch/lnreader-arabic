// Injected into the novel site's tab when the popup opens. It reads the page,
// finds the chapter text, the chapter list and the "next" link, and downloads
// chapters from inside the page so the site's cookies, login and security
// check apply. Saved chapters go to the extension's library via messages.
// Plain script (not a module) because it is injected with executeScript.
(() => {
  if (window.__lnrGrabber) return;

  const CHAPTER_WORD =
    /(chapter|chap\b|ch[\s._-]*\d|episode|\bep[\s._-]*\d|part\s*\d|الفصل|فصل|الحلقة|第\s*[\d一二三四五六七八九十百千零〇]+\s*[章节回话])/i;
  const NEXT_TEXT =
    /^\s*(next(\s*chapter)?|next\s*›|next\s*»|التالي|الفصل التالي|التالى|下一章|下一页|下一节|suivant|siguiente|próximo|nächstes?|›|»|>|→|>>)\s*[›»>→]?\s*$/i;
  const PREV_TEXT =
    /^\s*([‹«<←]?\s*(prev(ious)?(\s*chapter)?|السابق|الفصل السابق|上一章|上一页|précédent|anterior)|‹|«|<|←|<<)\s*$/i;
  const CONTENT_SELECTORS = [
    '#chapter-content',
    '#chr-content',
    '.chr-c',
    '#chapter-container',
    '.chapter-content',
    '.chapter__content',
    '.chapter-body',
    '.chapter_content',
    '#chapter_content',
    '#chaptercontent',
    '.reading-content .text-left',
    '.reading-content',
    '.epcontent',
    '.entry-content_wrap',
    '#novel_content',
    '#htmlContent',
    '.read-content',
    '.txtnav',
    '#content',
    '.chapter-inner',
    '.cha-words',
    '.text-content',
    '.entry-content',
    'article',
  ];
  const TOC_SELECTORS = [
    '.wp-manga-chapter a',
    '.eplister li a',
    '#chapterlist li a',
    '#list-chapter a',
    '.list-chapter a',
    '.chapter-list a',
    '#chapter-list a',
    'ul.chapters a',
    '.chapters a',
    '#chapters a',
    '.toc a',
    '#toc a',
    '.chapter-item a',
    '.volume-list a',
    '#chapter-list-table a',
    '.listing-chapters_wrap a',
  ];
  const JUNK =
    'script,style,noscript,iframe,ins,form,button,select,textarea,svg,nav,header,footer,aside,' +
    '.ads,.ad,.adsbygoogle,[class*="advert"],[id*="advert"],[class*="share"],[class*="comment"],' +
    '[class*="related"],[class*="breadcrumb"],[class*="nav-links"],[class*="pagination"],.hidden,[hidden],[aria-hidden="true"]';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clean = s => String(s || '').replace(/\s+/g, ' ').trim();
  const normUrl = (href, base) => {
    try {
      const u = new URL(href, base || location.href);
      u.hash = '';
      return u.href;
    } catch {
      return '';
    }
  };
  const firstNumber = s => {
    const m = String(s).match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : NaN;
  };

  // ---------- reading a chapter page ----------

  function toParagraphs(root) {
    const out = [];
    const blocks = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|SECTION|ARTICLE|PRE|TR|CENTER)$/;
    let line = '';
    const push = t => {
      const x = clean(line);
      if (x) out.push({ t, x });
      line = '';
    };
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) line += child.nodeValue;
        else if (child.nodeType === 1) {
          if (child.matches(JUNK)) continue;
          const st = child.getAttribute('style') || '';
          if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(st)) continue;
          const tag = child.tagName.toUpperCase();
          if (tag === 'BR') {
            push('p');
            continue;
          }
          const block = blocks.test(tag);
          if (block) push('p');
          walk(child);
          if (block) push(/^H[1-6]$/.test(tag) ? 'h' : 'p');
        }
      }
    };
    walk(root);
    push('p');
    return out.filter(p => !/^(advertisement|sponsored content|إعلان)$/i.test(p.x));
  }

  function linkDensity(el) {
    const text = clean(el.textContent).length || 1;
    let links = 0;
    for (const a of el.querySelectorAll('a')) links += clean(a.textContent).length;
    return links / text;
  }

  /** The element holding the chapter text: a known selector or the densest text block. */
  function findContent(doc) {
    for (const sel of CONTENT_SELECTORS) {
      for (const el of doc.querySelectorAll(sel)) {
        if (clean(el.textContent).length > 400 && linkDensity(el) < 0.3) return el;
      }
    }
    let best = null;
    let bestScore = 0;
    const candidates = new Set();
    for (const p of doc.querySelectorAll('p, br')) if (p.parentElement) candidates.add(p.parentElement);
    for (const el of doc.querySelectorAll('div, section, article, td')) {
      if (el.children.length < 80 && clean(el.textContent).length > 400) candidates.add(el);
    }
    for (const el of candidates) {
      let own = 0;
      for (const c of el.childNodes) {
        if (c.nodeType === 3) own += clean(c.nodeValue).length;
        else if (c.nodeType === 1 && /^(P|BR|SPAN|FONT|B|I|EM|STRONG)$/.test(c.tagName)) own += clean(c.textContent).length;
      }
      const score = own * (1 - Math.min(linkDensity(el), 0.9));
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best || doc.body;
  }

  function chapterTitle(doc, content) {
    for (const sel of ['.chapter-title', '.chr-title', '.chapter__title', '#chapter-heading', '.chapter-name']) {
      const t = clean(doc.querySelector(sel)?.textContent);
      if (t && t.length < 160) return t;
    }
    const heads = [...doc.querySelectorAll('h1, h2, h3, h4')].filter(h => {
      const t = clean(h.textContent);
      return t && t.length < 160 && !h.closest('nav, footer, aside, [class*="related"], [class*="comment"]');
    });
    const before = h => content && (content.contains(h) || h.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING);
    const pick =
      heads.find(h => before(h) && CHAPTER_WORD.test(h.textContent)) ||
      heads.find(h => CHAPTER_WORD.test(h.textContent));
    if (pick) return clean(pick.textContent);
    const parts = clean(doc.title).split(/\s+[-|–—]\s+/);
    const at = parts.findIndex(p => CHAPTER_WORD.test(p));
    if (at >= 0) return parts.slice(at).join(' - ');
    const h1 = heads.find(h => h.tagName === 'H1' && before(h)) || heads.find(h => h.matches('.entry-title'));
    const near = h1 || heads.filter(before).pop();
    return clean(near?.textContent) || clean(doc.title);
  }

  function findLink(doc, base, rel, textRe, classRe) {
    const linkRel = doc.querySelector(`link[rel~="${rel}"][href], a[rel~="${rel}"][href]`);
    if (linkRel) return normUrl(linkRel.getAttribute('href'), base);
    let found = '';
    for (const a of doc.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^javascript:/i.test(href)) continue;
      const text = clean(a.textContent || a.getAttribute('title') || a.getAttribute('aria-label'));
      const cls = `${a.id} ${a.className} ${a.parentElement?.className || ''}`;
      if (textRe.test(text) || (classRe.test(cls) && text.length < 40)) {
        if (a.matches('.disabled, [aria-disabled="true"]')) continue;
        found = normUrl(href, base);
        if (textRe.test(text)) break;
      }
    }
    return found;
  }

  function readChapter(doc, base) {
    const content = findContent(doc);
    let title = chapterTitle(doc, content);
    const box = content.cloneNode(true);
    for (const el of box.querySelectorAll(JUNK)) el.remove();
    const paragraphs = toParagraphs(box);
    // Drop a repeated title and leftover "next/previous" lines.
    while (paragraphs.length && (paragraphs[0].x === title || NEXT_TEXT.test(paragraphs[0].x) || PREV_TEXT.test(paragraphs[0].x))) paragraphs.shift();
    while (paragraphs.length && (NEXT_TEXT.test(paragraphs.at(-1).x) || PREV_TEXT.test(paragraphs.at(-1).x))) paragraphs.pop();
    if (!title && paragraphs[0] && paragraphs[0].x.length < 120) title = paragraphs.shift().x;
    const next = findLink(doc, base, 'next', NEXT_TEXT, /(^|[\s_-])next([\s_-]|$)|nextchap|next_page|btn-next/i);
    const prev = findLink(doc, base, 'prev', PREV_TEXT, /(^|[\s_-])prev([\s_-]|$)|prevchap|prev_page|btn-prev/i);
    const length = paragraphs.reduce((s, p) => s + p.x.length, 0);
    return { title, paragraphs, length, next: next !== normUrl(base) ? next : '', prev };
  }

  // ---------- novel info and chapter list ----------

  function meta(doc, name) {
    const el = doc.querySelector(`meta[property="${name}"], meta[name="${name}"]`);
    return el ? clean(el.getAttribute('content')) : '';
  }

  function siteName() {
    return meta(document, 'og:site_name') || location.hostname.replace(/^www\./, '');
  }

  function guessNovelTitle(doc, isChapter) {
    const t = guessTitle(doc, isChapter);
    // On a chapter page the guess often still ends with the chapter number.
    return isChapter ? t.replace(/[\s:–-]+[\d.]+$/, '').trim() || t : t;
  }

  function guessTitle(doc, isChapter) {
    const sels = ['.post-title h1', '.novel-title', '.book-name', '.book-title', '.series-title', '.entry-title', '.title-novel', 'h3.title', '[itemprop="name"]'];
    if (!isChapter) {
      for (const sel of sels) {
        const t = clean(doc.querySelector(sel)?.textContent);
        if (t && t.length < 150) return t;
      }
      const og = meta(doc, 'og:title');
      if (og) return og.split(/\s[-|–—»]\s/)[0];
    }
    const here = normUrl(location.href);
    const crumbs = [...doc.querySelectorAll('.breadcrumb a, .breadcrumbs a, [itemprop="itemListElement"] a, ol.breadcrumb li a, .ts-breadcrumb a')]
      .filter(a => normUrl(a.getAttribute('href')) !== here)
      .map(a => clean(a.textContent))
      .filter(t => t && !/^(home|الرئيسية|novels?|روايات|الروايات)$/i.test(t) && !CHAPTER_WORD.test(t));
    if (crumbs.length) return crumbs.at(-1);
    for (const a of doc.querySelectorAll('a.novel-title, a.book-title, .chr-text + a, a[class*="novel"], a[class*="series"]')) {
      const t = clean(a.textContent);
      if (t.length > 2 && t.length < 150 && !CHAPTER_WORD.test(t)) return t;
    }
    const site = siteName().toLowerCase();
    const parts = clean(doc.title)
      .split(/\s+[-|–—»:]\s+|\s*\|\s*/)
      .map(clean)
      .filter(p => p && p.toLowerCase() !== site && !p.toLowerCase().includes(site));
    const notChapter = parts.filter(p => !CHAPTER_WORD.test(p));
    let t = (notChapter[0] || parts[0] || clean(doc.title)).replace(CHAPTER_WORD, '').replace(/[\d.:\s-]+$/, '').trim();
    return t || clean(doc.title);
  }

  function novelInfo(doc, isChapter) {
    const summaryEl = doc.querySelector('.summary__content, .description, .desc, .synopsis, [itemprop="description"], .entry-content[itemprop="description"], #editdescription');
    const authorEl = doc.querySelector('.author-content a, [itemprop="author"], .author a, .info-author a, a[href*="/author/"]');
    const coverEl = doc.querySelector('.summary_image img, .book img, .cover img, .thumb img, img[itemprop="image"]');
    return {
      title: guessNovelTitle(doc, isChapter),
      author: clean(authorEl?.textContent),
      summary: isChapter ? '' : clean(summaryEl?.textContent).slice(0, 2000),
      cover: isChapter ? '' : meta(doc, 'og:image') || coverEl?.getAttribute('data-src') || coverEl?.src || '',
      url: location.href,
      host: location.hostname.replace(/^www\./, ''),
    };
  }

  function signature(el) {
    const parts = [];
    for (let n = el.parentElement, i = 0; n && i < 4; n = n.parentElement, i++) {
      parts.push(n.tagName + '.' + String(n.className || '').trim().split(/\s+/).sort().join('.'));
    }
    return parts.join('<');
  }

  function linksToChapters(anchors, base) {
    const seen = new Set();
    const out = [];
    for (const a of anchors) {
      const url = normUrl(a.getAttribute('href'), base);
      if (!url || seen.has(url) || !/^https?:/.test(url)) continue;
      seen.add(url);
      const label = a.cloneNode(true);
      for (const d of label.querySelectorAll('time, [class*="date"], [class*="time"], [class*="ago"], .chapter-release-date, .post-on')) d.remove();
      const title = clean(label.textContent || a.getAttribute('title'));
      out.push({ title: title || url.split('/').filter(Boolean).pop(), url, key: url });
    }
    // Drop buttons repeated next to every chapter (a "pdf" or "download" link).
    const seenTitles = {};
    for (const c of out) seenTitles[c.title] = (seenTitles[c.title] || 0) + 1;
    for (let i = out.length - 1; i >= 0; i--) {
      if (seenTitles[out[i].title] >= 3 && !/\d/.test(out[i].title)) out.splice(i, 1);
    }
    // Many sites list the newest chapter first.
    const nums = out.map(c => firstNumber(c.title)).filter(n => !isNaN(n));
    if (nums.length > 1 && nums[0] > nums.at(-1)) out.reverse();
    return out;
  }

  function findToc(doc, base) {
    for (const sel of TOC_SELECTORS) {
      const anchors = [...doc.querySelectorAll(sel)].filter(a => a.getAttribute('href') && !a.getAttribute('href').startsWith('#'));
      if (anchors.length >= 2) return { chapters: linksToChapters(anchors, base), selector: sel };
    }
    const host = new URL(base).host;
    const groups = new Map();
    for (const a of doc.querySelectorAll('a[href]')) {
      let u;
      try {
        u = new URL(a.getAttribute('href'), base);
      } catch {
        continue;
      }
      if (u.host !== host) continue;
      const text = clean(a.textContent);
      if (!CHAPTER_WORD.test(text) && !CHAPTER_WORD.test(decodeURIComponent(u.pathname))) continue;
      if (NEXT_TEXT.test(text) || PREV_TEXT.test(text) || /^(next|prev|previous)\b|التالي|السابق/i.test(text)) continue;
      if (a.closest('nav, header, footer, .menu')) continue;
      const sig = signature(a);
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(a);
    }
    let best = [];
    let bestSig = '';
    for (const [sig, list] of groups) {
      if (list.length > best.length) {
        best = list;
        bestSig = sig;
      }
    }
    const chapters = linksToChapters(best, base);
    return chapters.length >= 3 ? { chapters, signature: bestSig } : { chapters: [] };
  }

  /** Madara (WordPress) themes load the chapter list with a separate request. */
  async function madaraChapters() {
    if (!document.querySelector('#manga-chapters-holder, .c-page__content .page-content-listing, [class*="wp-manga"]')) return [];
    const base = location.href.split(/[?#]/)[0].replace(/\/$/, '');
    const tries = [
      () => fetch(base + '/ajax/chapters/', { method: 'POST', credentials: 'include' }),
      () => {
        const id = document.querySelector('#manga-chapters-holder')?.getAttribute('data-id') || document.querySelector('.rating-post-id')?.value;
        if (!id) return null;
        const body = new URLSearchParams({ action: 'manga_get_chapters', manga: id });
        return fetch(location.origin + '/wp-admin/admin-ajax.php', { method: 'POST', body, credentials: 'include' });
      },
    ];
    for (const t of tries) {
      try {
        const res = await t();
        if (!res || !res.ok) continue;
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const anchors = [...doc.querySelectorAll('.wp-manga-chapter a, li a')];
        if (anchors.length) return linksToChapters(anchors, location.href);
      } catch {}
    }
    return [];
  }

  /**
   * Follows the chapter list's own pages (?page=2 ...) and joins them. Each
   * page is already oldest-first; if the pages themselves run newest-first
   * (page 1 holds the latest chapters) they are joined in reverse.
   */
  async function expandToc(first, signal) {
    const pages = [first.chapters];
    const known = new Set(first.chapters.map(c => c.url));
    const seenPages = new Set([normUrl(location.href)]);
    let doc = document;
    let base = location.href;
    for (let i = 0; i < 200 && !signal.cancelled; i++) {
      const next =
        doc.querySelector('.pagination a[rel="next"], a[rel="next"], .pagination .next a, li.next a, a.next, a.page-next, .pagination li.active + li a')?.getAttribute('href');
      const url = next && normUrl(next, base);
      if (!url || seenPages.has(url)) break;
      seenPages.add(url);
      progress(`بجمع الفهرس... صفحة ${i + 2} (${known.size} فصل)`);
      doc = await fetchDoc(url);
      base = url;
      const page = first.selector
        ? linksToChapters([...doc.querySelectorAll(first.selector)], url)
        : findToc(doc, url).chapters;
      const fresh = page.filter(c => !known.has(c.url));
      if (!fresh.length) break;
      fresh.forEach(c => known.add(c.url));
      pages.push(fresh);
      await sleep(300);
    }
    const a = firstNumber(pages[0][0]?.title);
    const b = firstNumber(pages[1]?.[0]?.title);
    if (pages.length > 1 && b < a) pages.reverse();
    return pages.flat();
  }

  // ---------- fetching ----------

  async function fetchDoc(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error(`الموقع رد بـ ${res.status}`);
    const buf = await res.arrayBuffer();
    let charset = (res.headers.get('content-type') || '').match(/charset=([\w-]+)/i)?.[1];
    let text = new TextDecoder(charset || 'utf-8', { fatal: false }).decode(buf);
    if (!charset) {
      const m = text.slice(0, 3000).match(/<meta[^>]+charset=["']?([\w-]+)/i);
      if (m && !/utf-?8/i.test(m[1])) {
        try {
          text = new TextDecoder(m[1]).decode(buf);
        } catch {}
      }
    }
    if (/<title>\s*(Just a moment|Attention Required)/i.test(text) || /cf-chl|challenge-platform/.test(text.slice(0, 5000)) && text.length < 20000) {
      throw new Error('الموقع طالب فحص الأمان (Cloudflare). افتح أي فصل في التاب ده وعدّي الفحص، وبعدين جرب تاني.');
    }
    const doc = new DOMParser().parseFromString(text, 'text/html');
    if (!doc.querySelector('base')) {
      const b = doc.createElement('base');
      b.href = url;
      doc.head?.prepend(b);
    }
    return doc;
  }

  /** For sites that build the chapter with JavaScript: load it in a hidden frame. */
  function readInFrame(url, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;bottom:0;left:0;border:0';
      frame.src = url;
      let done = false;
      const finish = (fn, v) => {
        if (done) return;
        done = true;
        clearInterval(timer);
        frame.remove();
        fn(v);
      };
      const started = Date.now();
      const timer = setInterval(() => {
        try {
          const doc = frame.contentDocument;
          if (doc && doc.body) {
            const ch = readChapter(doc, url);
            if (ch.length > 300 && doc.readyState !== 'loading') finish(resolve, ch);
          }
        } catch {
          finish(reject, new Error('الصفحة مش راضية تتفتح جوه الإضافة'));
        }
        if (Date.now() - started > timeout) finish(reject, new Error('الفصل فاضي أو ما اتحمّلش'));
      }, 700);
      document.documentElement.appendChild(frame);
    });
  }

  async function loadChapter(url) {
    if (normUrl(url) === normUrl(location.href)) {
      const ch = readChapter(document, location.href);
      if (ch.length > 100) return ch;
    }
    const doc = await fetchDoc(url);
    const ch = readChapter(doc, url);
    if (ch.length > 300) return ch;
    try {
      return await readInFrame(url);
    } catch (e) {
      if (ch.length) return ch;
      throw e;
    }
  }

  // ---------- Fiction Zone (same API as the LNReader plugin) ----------

  const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

  function findToken(value, depth) {
    if (value === null || value === undefined || depth > 4) return undefined;
    if (typeof value === 'string') {
      const m = value.match(JWT);
      if (m) return m[0];
      if (/^[{["]/.test(value)) {
        try {
          return findToken(JSON.parse(value), depth + 1);
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value).sort((a, b) => (/token|auth|session|user/i.test(a) ? 0 : 1) - (/token|auth|session|user/i.test(b) ? 0 : 1));
      for (const k of keys) {
        const f = findToken(value[k], depth + 1);
        if (f) return f;
      }
    }
    return undefined;
  }

  const storageObject = s => {
    const o = {};
    try {
      for (let i = 0; i < s.length; i++) o[s.key(i)] = s.getItem(s.key(i));
    } catch {}
    return o;
  };

  const fz = {
    match: () => /(^|\.)fictionzone\.net$/.test(location.hostname),
    slug() {
      const p = location.pathname;
      const omni = p.match(/\/omniportal\/([a-z]+)\/(\d+)/i);
      if (omni) return `${omni[1].toLowerCase()}-${omni[2]}`;
      return p.match(/\/novel\/([^/?#]+)/)?.[1] || '';
    },
    token() {
      const c = document.cookie.match(/(?:^|;\s*)(?:auth[_-]?token|access[_-]?token|token)=([^;]+)/i);
      return findToken(storageObject(localStorage), 0) || findToken(storageObject(sessionStorage), 0) || (c && decodeURIComponent(c[1]));
    },
    async request(path, withAuth) {
      const headers = [['content-type', 'application/json']];
      const token = withAuth ? this.token() : undefined;
      if (token) headers.push(['authorization', 'Bearer ' + token]);
      const res = await fetch('/api/__api_party/fictionzone', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ path, headers, method: 'GET' }),
      });
      let json;
      try {
        json = JSON.parse(await res.text());
      } catch {
        throw new Error('فيكشن زون ما ردش. حدّث الصفحة وجرب تاني.');
      }
      if (!json.success) throw new Error(json.error?.message || json.message || 'Fiction Zone error');
      return json.data;
    },
    async api(path, withAuth) {
      try {
        return await this.request(path, withAuth);
      } catch (e) {
        if (withAuth && /token|unauthori/i.test(e.message)) return this.request(path, false);
        throw e;
      }
    },
    async analyze() {
      const slug = this.slug();
      if (!slug) return null;
      const d = await this.api('/platform/novel-details?slug=' + encodeURIComponent(slug), true);
      const list = await this.api('/platform/chapter-lists?novel_id=' + d.id, true);
      const chapters = (list.chapters || [])
        .slice()
        .sort((a, b) => parseFloat(a.chapter_number || 0) - parseFloat(b.chapter_number || 0))
        .map(c => ({ title: c.title, key: `fz:${c.chapter_id}`, url: `${location.origin}/novel/${slug}#${c.chapter_id}`, api: `/platform/chapter-content?novel_id=${d.id}&chapter_id=${c.chapter_id}` }));
      const author = (d.contributors || []).find(c => c.role === 'author');
      return {
        novel: {
          title: d.title,
          author: author ? author.display_name : '',
          summary: d.synopsis || '',
          cover: d.image ? `https://cdn.fictionzone.net/insecure/rs:fill:330:500/${d.image}.webp` : '',
          url: /^(fq|qimao)-/.test(slug) ? location.href : `${location.origin}/novel/${slug}`,
          host: 'fictionzone.net',
          source: 'fictionzone',
        },
        chapters,
        needsLogin: !chapters.length && /^(fq|qimao)-/.test(slug),
      };
    },
    async chapter(c) {
      const data = await this.api(c.api, true);
      let text = String(data.content || '').replace(/\r\n?/g, '\n');
      let paragraphs;
      if (/<(p|br|div)[\s>/]/i.test(text)) {
        paragraphs = toParagraphs(new DOMParser().parseFromString(text, 'text/html').body);
      } else {
        paragraphs = text.split(/\n+/).map(clean).filter(Boolean).map(x => ({ t: 'p', x }));
      }
      return { title: c.title, paragraphs, length: text.length };
    },
  };

  // ---------- files linked on the page ----------

  const FILE_EXT = /\.(epub|pdf|txt|mobi|azw3|docx?|zip|rar|7z|cbz|cbr|fb2)(?:$|[?#])/i;

  function pageFiles() {
    const seen = new Set();
    const out = [];
    for (const a of document.querySelectorAll('a[href]')) {
      const url = normUrl(a.getAttribute('href'));
      let path = '';
      try {
        path = new URL(url).pathname;
      } catch {
        continue;
      }
      const m = path.match(FILE_EXT) || (a.hasAttribute('download') ? [null, (path.split('.').pop() || 'file').slice(0, 5)] : null);
      if (!m || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, ext: m[1].toLowerCase(), name: clean(a.textContent) || decodeURIComponent(path.split('/').pop()) });
    }
    return out.slice(0, 100);
  }

  // ---------- progress box on the page ----------

  let box;
  function progress(text, done) {
    if (!box) {
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;bottom:16px;left:16px;';
      const root = host.attachShadow({ mode: 'open' });
      root.innerHTML = `<style>
        .b{font:14px/1.5 system-ui,"Segoe UI",Tahoma,sans-serif;background:#1f1b16;color:#f5ead8;border-radius:10px;padding:10px 12px;box-shadow:0 6px 24px #0006;max-width:340px;direction:rtl;display:flex;gap:10px;align-items:center}
        .t{flex:1}
        button{font:inherit;border:0;border-radius:6px;padding:4px 10px;cursor:pointer;background:#c8742d;color:#fff}
        button.x{background:#4a4038}
      </style><div class="b"><div class="t"></div><button class="s">وقّف</button><button class="x" hidden>اقفل</button></div>`;
      document.documentElement.appendChild(host);
      box = { host, text: root.querySelector('.t'), stop: root.querySelector('.s'), close: root.querySelector('.x') };
      box.stop.onclick = () => {
        if (job) job.cancelled = true;
      };
      box.close.onclick = () => {
        box.host.remove();
        box = null;
      };
    }
    box.text.textContent = text;
    box.stop.hidden = !!done;
    box.close.hidden = !done;
  }

  // ---------- jobs ----------

  let job = null;
  let lastAnalysis = null;
  const send = async msg => {
    const r = await chrome.runtime.sendMessage(msg);
    if (!r || r.error) throw new Error((r && r.error) || 'المكتبة ما ردتش');
    return r;
  };

  async function analyze() {
    const files = pageFiles();
    if (fz.match()) {
      try {
        const r = await fz.analyze();
        if (r) {
          lastAnalysis = { kind: 'fictionzone', ...r };
          return { ...lastAnalysis, files, running: job ? job.state : null };
        }
      } catch (e) {
        return { kind: 'error', error: e.message, files };
      }
    }
    const current = readChapter(document, location.href);
    let toc = findToc(document, location.href);
    if (toc.chapters.length < 3) {
      const madara = await madaraChapters();
      if (madara.length) toc = { chapters: madara, selector: '.wp-manga-chapter a' };
    }
    const isChapter = current.length > 1200 && (current.next || current.prev || toc.chapters.length < 10);
    const novel = novelInfo(document, isChapter);
    lastAnalysis = { kind: isChapter ? 'chapter' : toc.chapters.length ? 'toc' : current.length > 300 ? 'chapter' : 'unknown', novel, chapters: toc.chapters, toc, current: { title: current.title, length: current.length, next: current.next, prev: current.prev } };
    return { ...lastAnalysis, toc: undefined, tocPaged: !!document.querySelector('.pagination a, a[rel="next"]') && !isChapter, files, running: job ? job.state : null };
  }

  async function withRetry(fn, tries = 3) {
    for (let i = 0; ; i++) {
      try {
        return await fn();
      } catch (e) {
        if (i >= tries - 1 || /Cloudflare/.test(e.message)) throw e;
        await sleep(1500 * 2 ** i);
      }
    }
  }

  async function run(opts) {
    if (job) throw new Error('فيه تحميل شغال بالفعل');
    job = { cancelled: false, state: { saved: 0, total: 0, text: '' } };
    const settings = (await chrome.storage.local.get('settings')).settings || {};
    const delay = Math.max(0, Number(settings.delayMs ?? 800));
    const a = lastAnalysis || (await analyze());
    const novelData = { ...a.novel, title: opts.novelTitle || a.novel.title };
    const { novel } = await send({ type: 'saveNovel', novel: novelData });
    const skip = new Set(opts.skipSaved ? (await send({ type: 'savedKeys', novelId: novel.id })).keys : []);
    let saved = 0;
    let failed = 0;
    const report = (t, done) => {
      job.state.text = t;
      progress(t, done);
    };
    try {
      if (opts.mode === 'toc') {
        let list = a.chapters;
        if (opts.expand && a.kind !== 'fictionzone') list = await expandToc(a.toc, job);
        const from = Math.max(1, opts.from || 1);
        const to = Math.min(list.length, opts.to || list.length);
        const picked = list.slice(from - 1, to);
        job.state.total = picked.length;
        for (let i = 0; i < picked.length && !job.cancelled; i++) {
          const c = picked[i];
          const order = from + i;
          if (skip.has(c.key)) continue;
          report(`بحمّل ${i + 1} من ${picked.length}: ${c.title}`);
          try {
            const ch = await withRetry(() => (a.kind === 'fictionzone' ? fz.chapter(c) : loadChapter(c.url)));
            if (!ch.paragraphs.length) throw new Error('فصل فاضي');
            await send({ type: 'saveChapter', novelId: novel.id, chapter: { key: c.key, url: c.url, order, title: ch.title && ch.title.length < 160 && a.kind !== 'fictionzone' && CHAPTER_WORD.test(ch.title) ? ch.title : c.title || ch.title, paragraphs: ch.paragraphs } });
            saved++;
            job.state.saved = saved;
          } catch (e) {
            failed++;
            if (/Cloudflare/.test(e.message)) throw e;
          }
          if (delay) await sleep(delay);
        }
      } else {
        // Follow the "next" links starting from this page.
        let url = normUrl(location.href);
        const visited = new Set();
        const count = Math.max(1, opts.count || 1);
        job.state.total = count;
        for (let i = 0; i < count && url && !job.cancelled && !visited.has(url); i++) {
          visited.add(url);
          report(`بحمّل ${i + 1} من ${count}`);
          const ch = await withRetry(() => loadChapter(url));
          if (!ch.paragraphs.length) break;
          if (!skip.has(url)) {
            await send({ type: 'saveChapter', novelId: novel.id, chapter: { key: url, url, title: ch.title, paragraphs: ch.paragraphs } });
            saved++;
            job.state.saved = saved;
          }
          url = ch.next;
          if (url && i + 1 < count && delay) await sleep(delay);
        }
      }
      const end = job.cancelled ? 'وقفت التحميل.' : 'خلصت!';
      report(`${end} اتحفظ ${saved} فصل${failed ? `، و${failed} فشلوا` : ''} في مكتبة LNReader.`, true);
      return { saved, failed, novelId: novel.id };
    } catch (e) {
      report(`حصلت مشكلة: ${e.message} (اتحفظ ${saved} فصل)`, true);
      throw e;
    } finally {
      job = null;
    }
  }

  window.__lnrGrabber = { analyze, readChapter, findToc };

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.to !== 'grabber') return;
    const work = {
      analyze: () => analyze(),
      start: () => {
        // Answer at once; the page keeps downloading after the popup closes.
        run(msg.opts).catch(() => {});
        return Promise.resolve({ started: true });
      },
      cancel: () => {
        if (job) job.cancelled = true;
        return Promise.resolve({ ok: true });
      },
      status: () => Promise.resolve({ running: job ? job.state : null }),
    }[msg.cmd];
    if (!work) return;
    work().then(reply, e => reply({ error: e.message }));
    return true;
  });
})();
