// Reader and download settings, kept in chrome.storage.local.

export const DEFAULTS = {
  theme: 'sepia', // light | sepia | dark | black
  fontSize: 20,
  lineHeight: 1.9,
  width: 760,
  font: 'system',
  align: 'start', // start | justify
  direction: 'auto', // auto | rtl | ltr
  showTranslation: true, // read the Arabic translation when there is one
  autoTranslate: false, // translate chapters as they are opened
  bilingual: false, // show the original under each translated paragraph
  targetLang: 'ar',
  engine: 'auto', // auto (Edge then Google) | edge | google
  glossary: '',
  builtinGlossary: true,
  delayMs: 800, // pause between chapter downloads
};

export const FONTS = {
  system: 'system-ui, "Segoe UI", Tahoma, sans-serif',
  naskh: '"Noto Naskh Arabic", "Traditional Arabic", "Arabic Typesetting", serif',
  amiri: 'Amiri, "Sakkal Majalla", "Traditional Arabic", serif',
  kufi: '"Noto Kufi Arabic", "Segoe UI", Tahoma, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  sans: '"Segoe UI", Arial, sans-serif',
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
