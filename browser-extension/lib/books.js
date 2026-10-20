// Export saved novels as EPUB / TXT / HTML, and import EPUB / TXT / HTML files
// into the library. Zip is written uncompressed and read with the browser's
// own DecompressionStream, so no library is needed. Runs in extension pages.

// ---------- zip ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** files: [{ name, data: string | Uint8Array }] -> Blob (stored, no compression). */
export function makeZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local, name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + (p.byteLength ?? p.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/epub+zip' });
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads a zip file into a Map of name -> async () => Uint8Array. */
export function readZip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ده مش ملف zip/epub سليم');
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, async () => {
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const start = localOffset + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(start, start + size);
      if (method === 0) return raw;
      if (method === 8) return inflateRaw(raw);
      throw new Error(`zip method ${method} not supported`);
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ---------- export ----------

const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const isRtl = text => /[֐-ࣿ]/.test(String(text).slice(0, 400));

/** The text to export for a chapter: translation if asked and present. */
export function chapterText(chapter, useTranslation, lang = 'ar') {
  const tr = useTranslation && chapter.translations && chapter.translations[lang];
  return tr ? { title: tr.title, paragraphs: tr.paragraphs } : chapter;
}

function paragraphsHtml(paragraphs) {
  return paragraphs.map(p => (p.t === 'h' ? `<h3>${esc(p.x)}</h3>` : `<p>${esc(p.x)}</p>`)).join('\n');
}

export function buildEpub(novel, chapters, { useTranslation = false, lang = 'ar' } = {}) {
  const items = chapters.map(c => chapterText(c, useTranslation, lang));
  const sample = items.slice(0, 3).map(c => c.paragraphs.map(p => p.x).join(' ')).join(' ');
  const rtl = isRtl(sample);
  const bookLang = useTranslation ? lang : rtl ? 'ar' : 'en';
  const dir = rtl ? ' dir="rtl"' : '';
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const css = `body{line-height:1.8;margin:0 4%;}${rtl ? 'body{direction:rtl;text-align:right;}' : ''}h2{text-align:center;margin:1em 0;}p{margin:0 0 .8em;}`;
  const page = (title, body) =>
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${bookLang}" lang="${bookLang}"${dir}><head><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body${dir}>${body}</body></html>`;
  const files = [
    { name: 'mimetype', data: 'application/epub+zip' },
    {
      name: 'META-INF/container.xml',
      data: '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    },
    { name: 'OEBPS/style.css', data: css },
  ];
  const docs = [];
  const intro = [`<h1>${esc(novel.title)}</h1>`];
  if (novel.author) intro.push(`<p><b>${esc(novel.author)}</b></p>`);
  if (novel.summary) intro.push(...novel.summary.split('\n').filter(Boolean).map(l => `<p>${esc(l)}</p>`));
  if (novel.url) intro.push(`<p>${esc(novel.url)}</p>`);
  docs.push({ id: 'intro', title: novel.title, body: intro.join('\n') });
  items.forEach((c, i) =>
    docs.push({ id: `c${String(i + 1).padStart(5, '0')}`, title: c.title, body: `<h2>${esc(c.title)}</h2>\n${paragraphsHtml(c.paragraphs)}` }),
  );
  for (const d of docs) files.push({ name: `OEBPS/${d.id}.xhtml`, data: page(d.title, d.body) });
  files.push({
    name: 'OEBPS/nav.xhtml',
    data: `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${bookLang}"${dir}><head><title>${esc(novel.title)}</title></head><body><nav epub:type="toc"><ol>${docs.map(d => `<li><a href="${d.id}.xhtml">${esc(d.title)}</a></li>`).join('')}</ol></nav></body></html>`,
  });
  files.push({
    name: 'OEBPS/toc.ncx',
    data: `<?xml version="1.0" encoding="utf-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${id}"/></head><docTitle><text>${esc(novel.title)}</text></docTitle><navMap>${docs.map((d, i) => `<navPoint id="n${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(d.title)}</text></navLabel><content src="${d.id}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`,
  });
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  files.push({
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bid">${id}</dc:identifier><dc:title>${esc(novel.title)}</dc:title><dc:creator>${esc(novel.author || '')}</dc:creator><dc:language>${bookLang}</dc:language><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${docs.map(d => `<item id="${d.id}" href="${d.id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine toc="ncx"${rtl ? ' page-progression-direction="rtl"' : ''}>${docs.map(d => `<itemref idref="${d.id}"/>`).join('')}</spine></package>`,
  });
  return makeZip(files);
}

export function buildTxt(novel, chapters, opts = {}) {
  const out = [novel.title, novel.author || '', ''];
  for (const c of chapters) {
    const t = chapterText(c, opts.useTranslation, opts.lang);
    out.push('', t.title, '', ...t.paragraphs.map(p => p.x));
  }
  return new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' });
}

/** One self-contained HTML file; Edge's own page translation works on it. */
export function buildHtml(novel, chapters, opts = {}) {
  const items = chapters.map(c => chapterText(c, opts.useTranslation, opts.lang));
  const rtl = isRtl(items.slice(0, 2).map(c => c.paragraphs.map(p => p.x).join(' ')).join(' '));
  const toc = items.map((c, i) => `<li><a href="#c${i + 1}">${esc(c.title)}</a></li>`).join('');
  const body = items.map((c, i) => `<section id="c${i + 1}"><h2>${esc(c.title)}</h2>${paragraphsHtml(c.paragraphs)}</section>`).join('\n');
  const html = `<!doctype html><html lang="${rtl ? 'ar' : 'en'}"${rtl ? ' dir="rtl"' : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(novel.title)}</title><style>body{max-width:760px;margin:auto;padding:16px;font:20px/1.9 system-ui,"Segoe UI",Tahoma,sans-serif;background:#f6efe2;color:#2b2420}h2{margin-top:3em}a{color:#8a4b14}</style></head><body><h1>${esc(novel.title)}</h1><ol>${toc}</ol>${body}</body></html>`;
  return new Blob([html], { type: 'text/html;charset=utf-8' });
}

// ---------- import ----------

/** Turns an HTML element into [{ t, x }] paragraphs. */
export function domToParagraphs(root) {
  const out = [];
  const blockTags = /^(P|DIV|H[1-6]|LI|BLOCKQUOTE|SECTION|ARTICLE|PRE|TR)$/;
  let line = '';
  const push = t => {
    const x = line.replace(/\s+/g, ' ').trim();
    if (x) out.push({ t, x });
    line = '';
  };
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) line += child.nodeValue;
      else if (child.nodeType === 1) {
        const tag = child.tagName.toUpperCase();
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|BUTTON|FORM|IFRAME)$/.test(tag)) continue;
        if (tag === 'BR') {
          push('p');
          continue;
        }
        const block = blockTags.test(tag);
        if (block) push('p');
        walk(child);
        if (block) push(/^H[1-6]$/.test(tag) ? 'h' : 'p');
      }
    }
  };
  walk(root);
  push('p');
  return out;
}

const parseXml = (text, type = 'application/xhtml+xml') => {
  let doc = new DOMParser().parseFromString(text, type);
  if (doc.querySelector('parsererror')) doc = new DOMParser().parseFromString(text, 'text/html');
  return doc;
};

function resolvePath(base, href) {
  const parts = (base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : '') + decodeURIComponent(href.split('#')[0]);
  const stack = [];
  for (const seg of parts.split('/')) {
    if (seg === '..') stack.pop();
    else if (seg && seg !== '.') stack.push(seg);
  }
  return stack.join('/');
}

export async function importEpub(file) {
  const zip = readZip(await file.arrayBuffer());
  const text = async name => {
    const get = zip.get(name);
    if (!get) throw new Error(`${name} مش موجود في الملف`);
    return new TextDecoder().decode(await get());
  };
  const container = parseXml(await text('META-INF/container.xml'), 'application/xml');
  const opfPath = container.querySelector('rootfile').getAttribute('full-path');
  const opf = parseXml(await text(opfPath), 'application/xml');
  const meta = tag => opf.getElementsByTagNameNS('*', tag)[0]?.textContent?.trim() || '';
  const manifest = {};
  for (const item of opf.getElementsByTagName('item')) {
    manifest[item.getAttribute('id')] = { href: item.getAttribute('href'), props: item.getAttribute('properties') || '' };
  }
  const chapters = [];
  for (const ref of opf.getElementsByTagName('itemref')) {
    const item = manifest[ref.getAttribute('idref')];
    if (!item || /nav/.test(item.props)) continue;
    const path = resolvePath(opfPath, item.href);
    if (!zip.has(path)) continue;
    const doc = parseXml(await text(path));
    const body = doc.body || doc.documentElement;
    const paragraphs = domToParagraphs(body);
    if (!paragraphs.length) continue;
    let title = doc.querySelector('h1,h2,h3')?.textContent?.trim() || doc.title || '';
    if (title && paragraphs[0]?.x === title) paragraphs.shift();
    chapters.push({ title: title || `Chapter ${chapters.length + 1}`, paragraphs, key: path });
  }
  return { title: meta('title') || file.name.replace(/\.epub$/i, ''), author: meta('creator'), summary: meta('description').replace(/<[^>]+>/g, ''), chapters };
}

// Lines that start a chapter in plain text, in English, Arabic or Chinese.
const CHAPTER_LINE = /^\s*(?:(?:chapter|chap\.?|ch\.?|episode|الفصل|فصل|الحلقة)\s*[\d٠-٩一二三四五六七八九十百千零〇]+|第\s*[\d一二三四五六七八九十百千零〇]+\s*[章节回])/i;

export async function importText(file) {
  let text = await file.text();
  if (/\.html?$/i.test(file.name)) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const heads = [...doc.querySelectorAll('h1,h2')];
    if (heads.length > 1) {
      // Split at each heading so each becomes a chapter.
      const chapters = [];
      for (const h of doc.querySelectorAll('h2').length > 1 ? doc.querySelectorAll('h2') : heads) {
        const range = doc.createRange();
        range.setStartAfter(h);
        let end = h.nextElementSibling;
        while (end && !/^H[12]$/.test(end.tagName) && !end.querySelector('h1,h2')) end = end.nextElementSibling;
        if (end) range.setEndBefore(end);
        else range.setEndAfter(h.parentNode.lastChild);
        const box = doc.createElement('div');
        box.appendChild(range.cloneContents());
        const paragraphs = domToParagraphs(box);
        if (paragraphs.length) chapters.push({ title: h.textContent.trim(), paragraphs, key: `h${chapters.length + 1}` });
      }
      if (chapters.length) return { title: doc.title || file.name.replace(/\.\w+$/, ''), chapters };
    }
    text = domToParagraphs(doc.body).map(p => p.x).join('\n');
  }
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const chapters = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (CHAPTER_LINE.test(line) && line.length < 120) {
      current = { title: line, paragraphs: [], key: `t${chapters.length + 1}` };
      chapters.push(current);
    } else {
      if (!current) {
        current = { title: file.name.replace(/\.\w+$/, ''), paragraphs: [], key: 't0' };
        chapters.push(current);
      }
      current.paragraphs.push({ t: 'p', x: line });
    }
  }
  return { title: file.name.replace(/\.\w+$/, ''), chapters: chapters.filter(c => c.paragraphs.length) };
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, '').slice(0, 120);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
