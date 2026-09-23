const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { pathToFileURL } = require('url');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const AUDIO_DIR = path.join(ROOT, 'audio');
const TRANSLATIONS_DIR = path.join(ROOT, 'translations');
const LOCALES_DIR = path.join(ROOT, 'locales');
const CONFIG_DIR = path.join(ROOT, 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.ini');
const BUNDLED_FONTS_DIR = path.join(ROOT, 'assets', 'fonts');
const DEFAULT_FONT_FILE = path.join(BUNDLED_FONTS_DIR, 'myfont.ttf');
const REMOTE_AUDIO_FILE = path.join(AUDIO_DIR, 'links.json');
const USER_FONTS_DIR = path.join(app.getPath('userData'), 'fonts');
const USER_DATA_FILE = path.join(app.getPath('userData'), 'app-state.json');

const PRAYER_METHODS = [
  { id: 3, name: 'رابطة العالم الإسلامي — Muslim World League' },
  { id: 2, name: 'الجمعية الإسلامية لأمريكا الشمالية — ISNA' },
  { id: 5, name: 'هيئة المساحة المصرية — Egyptian General Authority of Survey' },
  { id: 4, name: 'جامعة أم القرى، مكة — Umm Al-Qura' },
  { id: 1, name: 'جامعة العلوم الإسلامية، كراتشي — Karachi' },
  { id: 7, name: 'معهد الجيوفيزياء، جامعة طهران — Tehran' },
  { id: 0, name: 'الشيعة الإثنا عشرية، قم — Jafari' },
  { id: 8, name: 'منطقة الخليج — Gulf Region' },
  { id: 9, name: 'الكويت — Kuwait' },
  { id: 10, name: 'قطر — Qatar' },
  { id: 11, name: 'سنغافورة — Singapore' },
  { id: 12, name: 'فرنسا — France' },
  { id: 13, name: 'تركيا — Diyanet (تجريبي)' },
  { id: 14, name: 'روسيا — Spiritual Administration' },
  { id: 15, name: 'لجنة رؤية الهلال — Moonsighting Committee' },
  { id: 16, name: 'دبي — Dubai (تجريبي)' },
  { id: 17, name: 'ماليزيا — JAKIM' },
  { id: 18, name: 'تونس — Tunisia' },
  { id: 19, name: 'الجزائر — Algeria' },
  { id: 20, name: 'إندونيسيا — Kemenag' },
  { id: 21, name: 'المغرب — Morocco' },
  { id: 22, name: 'البرتغال — Comunidade Islamica de Lisboa' },
  { id: 23, name: 'الأردن — وزارة الأوقاف الأردنية' }
];

function ensureDirs() {
  for (const dir of [DATA_DIR, AUDIO_DIR, TRANSLATIONS_DIR, LOCALES_DIR, CONFIG_DIR, BUNDLED_FONTS_DIR, USER_FONTS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function parseIni(text) {
  const result = {};
  let section = 'root';
  result[section] = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      result[section] ||= {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);
    result[section][key] = value;
  }
  return result;
}

function readConfig() {
  const fallback = {
    app: { default_language: 'ar', default_theme: 'dark', default_font: 'myfont.ttf', default_quran_font_size: 30, default_line_height: 2.1 },
    search: { max_quran_results: 50, max_hadith_results: 30 },
    storage: { autosave: true }
  };
  try {
    if (!fs.existsSync(CONFIG_FILE)) return fallback;
    const parsed = parseIni(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return {
      ...fallback,
      ...parsed,
      app: { ...fallback.app, ...(parsed.app || {}) },
      search: { ...fallback.search, ...(parsed.search || {}) },
      storage: { ...fallback.storage, ...(parsed.storage || {}) }
    };
  } catch (error) {
    console.error('Failed to read config:', error);
    return fallback;
  }
}

function safeJsonRead(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`Failed to read JSON: ${filePath}`, error);
    return fallback;
  }
}

function safeJsonWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

function defaultState() {
  const config = readConfig();
  return {
    settings: {
      theme: String(config.app.default_theme || 'dark'),
      language: String(config.app.default_language || 'ar'),
      fontSize: Number(config.app.default_quran_font_size || 30),
      lineHeight: Number(config.app.default_line_height || 2.1),
      translation: 'ar', reciter: '', repeatCount: 1, autoplay: true, autoNext: true,
      dailyTarget: 5, focusMode: false, fontFamily: 'myfont.ttf', arabicFont: String(config.app.default_font || 'myfont.ttf'),
      prayerMethod: 5, prayerSchool: 0, prayerMidnightMode: 'Standard', prayerLatitudeAdjustment: 'ANGLE_BASED'
    },
    lastRead: { chapter: 1, verse: 1, page: null },
    favorites: [], notes: {}, readVerses: {}, tasbih: { count: 0, target: 33, total: 0 }, readingLog: {}, toolState: {},
    prayer: { location: null, cache: {}, lastUpdated: null },
    createdAt: new Date().toISOString()
  };
}

function loadState() {
  const fallback = defaultState();
  const value = safeJsonRead(USER_DATA_FILE, fallback) || {};
  return {
    ...fallback,
    ...value,
    settings: { ...fallback.settings, ...(value.settings || {}) },
    prayer: { ...fallback.prayer, ...(value.prayer || {}) }
  };
}

function saveState(state) { safeJsonWrite(USER_DATA_FILE, state); }

function getFirstExisting(files) {
  for (const file of files) if (fs.existsSync(file)) return file;
  return null;
}

function getQuran() {
  const file = getFirstExisting([path.join(DATA_DIR, 'quran.json'), path.join(DATA_DIR, 'quran-data.json')]);
  return file ? safeJsonRead(file, {}) : {};
}

const HADITH_TEXT_KEYS = ['text', 'matn', 'arabic', 'arabicText', 'arabic_text', 'content', 'body', 'hadithText', 'hadith_text'];
function extractHadithText(item) {
  if (!item || typeof item !== 'object') return '';
  for (const key of HADITH_TEXT_KEYS) {
    if (typeof item[key] === 'string' && item[key].trim()) return item[key].trim();
  }
  return '';
}

function flattenHadithData(data, inherited = {}, out = []) {
  if (Array.isArray(data)) {
    for (const item of data) flattenHadithData(item, inherited, out);
    return out;
  }
  if (!data || typeof data !== 'object') return out;

  const text = extractHadithText(data);
  if (text) {
    out.push({
      id: data.id ?? data.number ?? `${out.length + 1}`,
      text,
      source: data.source ?? data.collection ?? data.book ?? inherited.source ?? inherited.book ?? '',
      book: data.book ?? inherited.book ?? '',
      chapter: data.chapter ?? inherited.chapter ?? '',
      narrator: data.narrator ?? data.rawi ?? data.narrator_name ?? '',
      reference: data.reference ?? data.ref ?? ''
    });
    return out;
  }

  const nextContext = {
    source: data.source ?? data.collection ?? inherited.source,
    book: data.book ?? inherited.book,
    chapter: data.chapter ?? inherited.chapter
  };
  for (const [key, value] of Object.entries(data)) {
    if (['meta', 'metadata', 'info', 'description'].includes(key)) continue;
    const context = { ...nextContext };
    if (!context.book && /book|كتاب/i.test(key)) context.book = key;
    if (!context.chapter && /chapter|باب|قسم/i.test(key)) context.chapter = key;
    flattenHadithData(value, context, out);
  }
  return out;
}

function getHadith() {
  const file = getFirstExisting([path.join(DATA_DIR, 'hadith.json'), path.join(DATA_DIR, 'hadith-data.json')]);
  if (!file) return [];
  return flattenHadithData(safeJsonRead(file, []), {}).filter(h => h.text);
}

function readRemoteAudioConfig() {
  ensureDirs();
  const fallback = { default: '', reciters: [] };
  if (!fs.existsSync(REMOTE_AUDIO_FILE)) return fallback;
  const data = safeJsonRead(REMOTE_AUDIO_FILE, fallback);
  if (!data || typeof data !== 'object') return fallback;
  const reciters = Array.isArray(data.reciters) ? data.reciters.filter(r => r && typeof r === 'object' && r.name) : [];
  return { default: String(data.default || ''), reciters };
}

function listReciters() {
  ensureDirs();
  const entries = fs.readdirSync(AUDIO_DIR, { withFileTypes: true });
  const localDirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => a.localeCompare(b, 'ar'));
  const rootFiles = entries.filter(e => e.isFile() && /\.mp3$/i.test(e.name));
  if (rootFiles.length) localDirs.unshift('default');
  const remote = readRemoteAudioConfig().reciters.map(r => String(r.name)).filter(Boolean);
  return [...new Set([...localDirs, ...remote])];
}

function remoteAudioFor(reciter, chapter) {
  const config = readRemoteAudioConfig();
  const selected = String(reciter || config.default || '');
  const item = config.reciters.find(r => String(r.name) === selected || String(r.id || '') === selected);
  if (!item) return null;
  const template = typeof item.template === 'string' ? item.template : (typeof item.urlTemplate === 'string' ? item.urlTemplate : '');
  if (!template) return null;
  const n = Number(chapter);
  if (!Number.isInteger(n) || n < 1 || n > 114) return null;
  const padded = String(n).padStart(3, '0');
  return template
    .replaceAll('{chapter}', String(n))
    .replaceAll('{chapter2}', String(n).padStart(2, '0'))
    .replaceAll('{chapter3}', padded);
}

function getChapterAudioNames(chapter) {
  const n = Number(chapter);
  return [
    `${String(n).padStart(3, '0')}.mp3`, `${String(n).padStart(2, '0')}.mp3`, `${n}.mp3`,
    `${String(n).padStart(3, '0')} - ${n}.mp3`, `${String(n).padStart(2, '0')} - ${n}.mp3`
  ];
}

function audioPathFor(reciter, chapter) {
  const names = getChapterAudioNames(chapter);
  const base = reciter && reciter !== 'default' ? path.join(AUDIO_DIR, reciter) : AUDIO_DIR;
  const direct = getFirstExisting(names.map(n => path.join(base, n)));
  if (direct) return direct;

  // Support common formats where the numeric surah is embedded in the filename.
  if (fs.existsSync(base) && fs.statSync(base).isDirectory()) {
    const files = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isFile() && /\.mp3$/i.test(e.name));
    const re = new RegExp(`(?:^|[^0-9])0*${Number(chapter)}(?:[^0-9]|$)`);
    const match = files.find(e => re.test(path.parse(e.name).name));
    return match ? path.join(base, match.name) : null;
  }
  return null;
}

function listTranslations() {
  ensureDirs();
  return fs.readdirSync(TRANSLATIONS_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.json'))
    .map(e => path.basename(e.name, '.json')).sort();
}

function listLanguages() {
  ensureDirs();
  return fs.readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.ini'))
    .map(e => path.basename(e.name, '.ini')).sort();
}

function getLanguage(code) {
  const safeCode = String(code || 'ar').replace(/[^a-zA-Z0-9_-]/g, '');
  const file = path.join(LOCALES_DIR, `${safeCode}.ini`);
  if (!fs.existsSync(file)) return null;
  return parseIni(fs.readFileSync(file, 'utf8'));
}

function normalizeTranslation(data) {
  const map = new Map();
  if (Array.isArray(data)) {
    for (const item of data) {
      const c = Number(item?.chapter), v = Number(item?.verse);
      if (Number.isFinite(c) && Number.isFinite(v) && item?.text) map.set(`${c}:${v}`, String(item.text));
    }
  } else if (data && typeof data === 'object') {
    for (const [chapterKey, verses] of Object.entries(data)) {
      if (Array.isArray(verses)) for (const item of verses) {
        const v = Number(item?.verse); if (Number.isFinite(v) && item?.text) map.set(`${Number(chapterKey)}:${v}`, String(item.text));
      } else if (verses && typeof verses === 'object') for (const [verseKey, item] of Object.entries(verses)) {
        if (typeof item === 'string') map.set(`${Number(chapterKey)}:${Number(verseKey)}`, item);
        else if (item?.text) map.set(`${Number(chapterKey)}:${Number(verseKey)}`, String(item.text));
      }
    }
  }
  return Object.fromEntries(map.entries());
}

function listFonts() {
  ensureDirs();
  const ext = /\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/;
  const dirs = [BUNDLED_FONTS_DIR, USER_FONTS_DIR];
  const out = [];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!file.isFile() || !ext.test(file.name)) continue;
      const full = path.join(dir, file.name);
      out.push({ name: path.basename(file.name, path.extname(file.name)), fileName: file.name, url: pathToFileURL(full).toString(), user: dir === USER_FONTS_DIR, builtin: dir === BUNDLED_FONTS_DIR });
    }
  }
  return out;
}

function httpsJson(url, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'QuranElectronApp/2.1' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (!body) return reject(new Error(`Empty response (${res.statusCode})`));
        try {
          const json = JSON.parse(body);
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`HTTP ${res.statusCode}`));
          resolve(json);
        } catch (e) { reject(new Error(`Invalid JSON response: ${e.message}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error('Network timeout')));
  });
}

async function fetchPrayerMonth(params) {
  const year = Number(params?.year), month = Number(params?.month), method = Number(params?.method ?? 5);
  const school = Number(params?.school ?? 0);
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('تاريخ الشهر غير صالح');
  const q = new URLSearchParams(); q.set('method', String(method)); q.set('school', String(school));
  if (params?.midnightMode) q.set('midnightMode', String(params.midnightMode));
  if (params?.latitudeAdjustmentMethod) q.set('latitudeAdjustmentMethod', String(params.latitudeAdjustmentMethod));
  if (params?.tune) q.set('tune', String(params.tune));
  let endpoint;
  if (params?.mode === 'coordinates') {
    const lat = Number(params.latitude), lon = Number(params.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('الإحداثيات غير صالحة');
    q.set('latitude', String(lat)); q.set('longitude', String(lon));
    endpoint = `https://api.aladhan.com/v1/calendar/${year}/${month}?${q.toString()}`;
  } else {
    const address = String(params?.address || '').trim();
    if (!address) throw new Error('اكتب اسم المدينة أو العنوان');
    q.set('address', address);
    endpoint = `https://api.aladhan.com/v1/calendarByAddress/${year}/${month}?${q.toString()}`;
  }
  const result = await httpsJson(endpoint);
  if (!result || result.code !== 200 || !Array.isArray(result.data)) throw new Error(result?.status || 'تعذر جلب مواقيت الشهر');
  return { source: 'AlAdhan', endpoint, fetchedAt: new Date().toISOString(), data: result.data };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 430, minHeight: 600, backgroundColor: '#0d1117', show: false,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.loadFile(path.join(ROOT, 'index.html'));
  win.once('ready-to-show', () => win.show());
  return win;
}

app.whenReady().then(() => {
  ensureDirs();
  let state = loadState();
  const win = createWindow();

  ipcMain.handle('app:get-data', () => ({
    quran: getQuran(),
    hadith: getHadith(),
    state,
    reciters: listReciters(),
    translations: listTranslations(),
    fonts: listFonts(),
    languages: listLanguages(),
    config: readConfig(),
    quranAvailable: Object.keys(getQuran()).length > 0,
    hadithAvailable: getHadith().length > 0,
    prayerMethods: PRAYER_METHODS
  }));
  ipcMain.handle('app:get-translation', (_e, code) => code === 'ar' ? {} : normalizeTranslation(safeJsonRead(path.join(TRANSLATIONS_DIR, `${code}.json`), {})));
  ipcMain.handle('app:get-language', (_e, code) => getLanguage(code));
  ipcMain.handle('app:get-audio', (_e, { reciter, chapter }) => {
    const selected = String(reciter || '');
    const localFile = audioPathFor(selected, Number(chapter));
    if (localFile) {
      return {
        src: pathToFileURL(localFile).toString(),
        source: 'local',
        file: path.basename(localFile),
        reciter: selected,
        fallback: remoteAudioFor(selected, Number(chapter))
      };
    }
    const remoteUrl = remoteAudioFor(selected, Number(chapter));
    if (remoteUrl) {
      const config = readRemoteAudioConfig();
      const item = config.reciters.find(r => String(r.name) === selected || String(r.id || '') === selected);
      const fallbackTemplate = typeof item?.fallbackTemplate === 'string' ? item.fallbackTemplate : '';
      const n = Number(chapter);
      const fallback = fallbackTemplate ? fallbackTemplate.replaceAll('{chapter}', String(n)).replaceAll('{chapter2}', String(n).padStart(2,'0')).replaceAll('{chapter3}', String(n).padStart(3,'0')) : null;
      return { src: remoteUrl, source: 'remote', file: null, reciter: selected, fallback };
    }
    return null;
  });
  ipcMain.handle('app:get-audio-check', (_e, { reciter } = {}) => {
    const selected = String(reciter || '');
    const result = [];
    for (let chapter = 1; chapter <= 114; chapter++) {
      const localFile = audioPathFor(selected, chapter);
      if (localFile) { result.push({ chapter, source: 'local', file: path.basename(localFile), url: null }); continue; }
      const remoteUrl = remoteAudioFor(selected, chapter);
      result.push({ chapter, source: remoteUrl ? 'remote' : null, file: null, url: remoteUrl || null });
    }
    return result;
  });
  ipcMain.handle('app:save-state', (_e, next) => { if (next && typeof next === 'object') { state = next; saveState(state); } return true; });
  ipcMain.handle('app:fetch-prayer-month', (_e, params) => fetchPrayerMonth(params));
  ipcMain.handle('app:get-prayer-methods', () => PRAYER_METHODS);
  ipcMain.handle('app:choose-font', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Arabic fonts', extensions: ['ttf','otf','woff','woff2'] }] });
    if (result.canceled || !result.filePaths[0]) return null;
    const src = result.filePaths[0];
    const ext = path.extname(src).toLowerCase();
    if (!['.ttf','.otf','.woff','.woff2'].includes(ext)) return null;
    ensureDirs();
    const safeName = path.basename(src).replace(/[^\p{L}\p{N}._-]+/gu, '_');
    const dest = path.join(USER_FONTS_DIR, safeName);
    fs.copyFileSync(src, dest);
    return { name: path.basename(safeName, ext), fileName: safeName, url: pathToFileURL(dest).toString(), user: true };
  });
  ipcMain.handle('app:open-folder', async (_e, folder) => {
    const allowed = { data: DATA_DIR, audio: AUDIO_DIR, translations: TRANSLATIONS_DIR, locales: LOCALES_DIR, config: CONFIG_DIR, fonts: BUNDLED_FONTS_DIR };
    if (!allowed[folder]) return false;
    await shell.openPath(allowed[folder]); return true;
  });
  ipcMain.handle('app:copy-text', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('app:export-state', async (_e, payload) => {
    const result = await dialog.showSaveDialog(win, { title: 'تصدير بيانات التطبيق', defaultPath: path.join(app.getPath('documents'), 'quran-app-backup.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false; safeJsonWrite(result.filePath, payload); return true;
  });
  ipcMain.handle('app:import-state', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return null; return safeJsonRead(result.filePaths[0], null);
  });
  ipcMain.on('app:quit', () => app.quit());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
