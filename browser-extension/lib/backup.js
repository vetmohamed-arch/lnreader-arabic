// Whole-library backup: one gzipped JSON file with every novel, chapter,
// translation and the settings. Restoring merges into the current library.
import { listNovels, listChapters, getNovel, saveNovel, putChapter } from './db.js';
import { getSettings, setSettings } from './settings.js';

const FORMAT = 'lnreader-web-backup';

export async function makeBackup() {
  // Built in pieces so a big library is never one giant string.
  const parts = [`{"format":"${FORMAT}","version":1,"createdAt":${Date.now()},"settings":${JSON.stringify(await getSettings())},"novels":[`];
  const novels = await listNovels();
  novels.forEach((n, i) => parts.push((i ? ',' : '') + JSON.stringify(n)));
  parts.push('],"chapters":[');
  let first = true;
  for (const n of novels) {
    for (const c of await listChapters(n.id)) {
      parts.push((first ? '' : ',') + JSON.stringify(c));
      first = false;
    }
  }
  parts.push(']}');
  const stream = new Blob(parts, { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
  return { blob: await new Response(stream).blob(), novels: novels.length };
}

export async function restoreBackup(file) {
  let stream = file.stream();
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream('gzip'));
  const data = JSON.parse(await new Response(stream).text());
  if (data.format !== FORMAT) throw new Error('ده مش ملف نسخة احتياطية من LNReader Web');
  for (const n of data.novels || []) {
    // Keep the newer reading position when the novel is already here.
    const old = await getNovel(n.id);
    await saveNovel(old && (old.updatedAt || 0) > (n.updatedAt || 0) ? { ...n, lastRead: old.lastRead } : n);
  }
  for (const c of data.chapters || []) await putChapter(c);
  if (data.settings) await setSettings(data.settings);
  return { novels: (data.novels || []).length, chapters: (data.chapters || []).length };
}
