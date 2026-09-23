(() => {
  'use strict';

  const SURAH_NAMES = ['الفاتحة','البقرة','آل عمران','النساء','المائدة','الأنعام','الأعراف','الأنفال','التوبة','يونس','هود','يوسف','الرعد','إبراهيم','الحجر','النحل','الإسراء','الكهف','مريم','طه','الأنبياء','الحج','المؤمنون','النور','الفرقان','الشعراء','النمل','القصص','العنكبوت','الروم','لقمان','السجدة','الأحزاب','سبأ','فاطر','يس','الصافات','ص','الزمر','غافر','فصلت','الشورى','الزخرف','الدخان','الجاثية','الأحقاف','محمد','الفتح','الحجرات','ق','الذاريات','الطور','النجم','القمر','الرحمن','الواقعة','الحديد','المجادلة','الحشر','الممتحنة','الصف','الجمعة','المنافقون','التغابن','الطلاق','التحريم','الملك','القلم','الحاقة','المعارج','نوح','الجن','المزمل','المدثر','القيامة','الإنسان','المرسلات','النبأ','النازعات','عبس','التكوير','الانفطار','المطففين','الانشقاق','البروج','الطارق','الأعلى','الغاشية','الفجر','البلد','الشمس','الليل','الضحى','الشرح','التين','العلق','القدر','البينة','الزلزلة','العاديات','القارعة','التكاثر','العصر','الهمزة','الفيل','قريش','الماعون','الكوثر','الكافرون','النصر','المسد','الإخلاص','الفلق','الناس'];
  const state = { quran: {}, hadith: [], reciters: [], translations: [], fonts: [], languages: [], prayerMethods: [], config: {}, app: null, translationMap: {}, locale: null, localeCode: 'ar' };
  let prayerMonthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let prayerCountdownTimer = null;
  let prayerLocationAttempted = false;
  let repeatLeft = 1;
  let noteKey = null;
  let searchTimer = null;
  let currentAudioChapter = null;
  let currentChapter = 1;
  let chapterRenderToken = 0;
  let currentAudioSourceLabel = null;
  let currentAudioRemoteFallback = null;

  const $ = id => document.getElementById(id);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const surahName = n => SURAH_NAMES[Number(n) - 1] || `السورة ${n}`;
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  function get(obj, dotted) { return String(dotted || '').split('.').reduce((acc, k) => acc?.[k], obj); }
  function t(key, fallback = key) { return String(get(state.locale, key) ?? fallback); }
  function htmlLines(value) { return esc(value).replace(/\n/g, '<br>'); }

  function normalizeSearch(value) {
    return String(value ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
      .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function flattenQuran(data) {
    const out = [];
    if (Array.isArray(data)) {
      for (const item of data) if (item && item.text) out.push({ ...item, chapter: Number(item.chapter), verse: Number(item.verse) });
    } else {
      for (const [key, arr] of Object.entries(data || {})) {
        if (!Array.isArray(arr)) continue;
        for (const item of arr) if (item && item.text) out.push({ ...item, chapter: Number(item.chapter ?? key), verse: Number(item.verse) });
      }
    }
    return out.filter(v => Number.isFinite(v.chapter) && Number.isFinite(v.verse)).sort((a,b) => a.chapter-b.chapter || a.verse-b.verse);
  }

  function versesForChapter(chapter) {
    const raw = state.quran?.[chapter] ?? state.quran?.[String(chapter)];
    if (Array.isArray(raw)) return raw.map(v => ({ ...v, chapter: Number(v.chapter ?? chapter), verse: Number(v.verse) })).filter(v => Number.isFinite(v.verse)).sort((a,b) => a.verse-b.verse);
    return flattenQuran(state.quran).filter(v => v.chapter === Number(chapter));
  }

  function ensureState() {
    state.app ||= {};
    state.app.settings = { theme: 'dark', language: state.config?.app?.default_language || 'ar', fontSize: Number(state.config?.app?.default_quran_font_size || 30), lineHeight: Number(state.config?.app?.default_line_height || 2.1), translation:'ar', reciter:'', repeatCount:1, autoplay:true, autoNext:true, dailyTarget:5, arabicFont: state.config?.app?.default_font || 'myfont.ttf', prayerMethod:5, prayerSchool:0, prayerMidnightMode:'Standard', prayerLatitudeAdjustment:'ANGLE_BASED', ...(state.app.settings || {}) };
    state.app.favorites = Array.isArray(state.app.favorites) ? state.app.favorites : [];
    state.app.notes = state.app.notes && typeof state.app.notes === 'object' ? state.app.notes : {};
    state.app.readingLog = state.app.readingLog && typeof state.app.readingLog === 'object' ? state.app.readingLog : {};
    state.app.readVerses = state.app.readVerses && typeof state.app.readVerses === 'object' ? state.app.readVerses : {};
    state.app.tasbih = { count:0, target:33, total:0, ...(state.app.tasbih || {}) };
    state.app.lastRead = { chapter:1, verse:1, page:null, ...(state.app.lastRead || {}) };
    state.app.prayer = { location:null, cache:{}, lastUpdated:null, ...(state.app.prayer || {}) };
    state.app.prayer.cache ||= {};
  }

  async function persist() { await window.quranAPI.saveState(state.app); }
  function setToast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(setToast.timer); setToast.timer = setTimeout(() => el.classList.remove('show'), 2400); }

  function applyTheme() {
    const theme = state.app.settings.theme || 'dark';
    const light = theme === 'light' || (theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);
    document.body.classList.toggle('light', light);
    document.documentElement.style.setProperty('--quranFont', `${Number(state.app.settings.fontSize || 30)}px`);
    document.documentElement.style.setProperty('--quranLine', String(state.app.settings.lineHeight || 2.1));
    applyQuranFont();
  }

  async function applyQuranFont() {
    const selected = state.app?.settings?.arabicFont || state.config?.app?.default_font || 'myfont.ttf';
    document.documentElement.style.setProperty('--quranFamily', selected ? '"QuranLocal","MyProgramFont","Amiri","Noto Naskh Arabic",serif' : '"MyProgramFont","Amiri",serif');
    const font = state.fonts.find(f => f.fileName === selected || f.name === selected);
    $('fontStatus').textContent = font ? `✓ ${font.name}` : t('dynamic.font_missing', 'لم يتم العثور على myfont.ttf بعد.');
    if (!font?.url) return;
    try {
      const fontFace = new FontFace('QuranLocal', `url("${font.url}")`);
      await fontFace.load(); document.fonts.add(fontFace);
    } catch (error) { console.warn('Arabic font load failed', error); }
  }

  async function applyLanguage(code) {
    const requested = state.languages.includes(code) ? code : (state.languages[0] || 'ar');
    const locale = await window.quranAPI.getLanguage(requested);
    if (!locale) return;
    state.locale = locale; state.localeCode = requested;
    document.documentElement.lang = String(locale.meta?.locale || requested).split('-')[0];
    document.documentElement.dir = locale.meta?.dir === 'ltr' ? 'ltr' : 'rtl';
    document.querySelectorAll('[data-i18n]').forEach(el => { const value = t(el.dataset.i18n); if (value !== el.dataset.i18n) el.textContent = value; });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder, el.placeholder); });
    document.title = `${t('ui.brand','مصحف محلي')} — Quran Offline`;
    $('uiLanguage').value = requested;
    await persistLanguage(requested);
    renderAll();
  }

  async function persistLanguage(code) { state.app.settings.language = code; await persist(); }

  function populateSelectors() {
    $('surahSelect').innerHTML = Array.from({length:114}, (_, i) => { const n=i+1; return `<option value="${n}">${String(n).padStart(3,'0')} — ${esc(surahName(n))}</option>`; }).join('');
    $('reciterSelect').innerHTML = `<option value="">${esc(t('ui.choose_reciter','اختر قارئًا'))}</option>` + state.reciters.map(r => `<option value="${esc(r)}">${esc(r === 'default' ? 'قارئ افتراضي' : r)}</option>`).join('');
    $('translationSelect').innerHTML = `<option value="ar">${esc(t('ui.original_arabic','العربية (النص الأصلي)'))}</option>` + state.translations.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    $('translationSelect').value = state.app.settings.translation || 'ar';
    $('reciterSelect').value = state.app.settings.reciter || state.reciters[0] || '';
    $('surahSelect').value = String(state.app.lastRead.chapter || 1);
    $('tasbihTarget').value = String(state.app.tasbih.target || 33);
    const methods = state.prayerMethods.length ? state.prayerMethods : [{id:5,name:'هيئة المساحة المصرية'}];
    $('prayerMethod').innerHTML = methods.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
    $('prayerMethod').value = String(state.app.settings.prayerMethod || 5); $('prayerSchool').value = String(state.app.settings.prayerSchool || 0);
    $('fontSelect').innerHTML = `<option value="myfont.ttf">myfont.ttf</option>` + state.fonts.filter(f => f.fileName !== 'myfont.ttf').map(f => `<option value="${esc(f.fileName)}">${esc(f.name)}${f.user ? ' — مستورد' : ''}</option>`).join('');
    $('fontSelect').value = state.app.settings.arabicFont || 'myfont.ttf';
    $('uiLanguage').innerHTML = state.languages.map(code => `<option value="${esc(code)}">${esc(code)}</option>`).join('');
    $('uiLanguage').value = state.app.settings.language || 'ar';
  }

  function renderAlert() {
    const missing = [];
    if (!Object.keys(state.quran || {}).length) missing.push('data/quran.json');
    if (!state.hadith.length) missing.push('data/hadith.json');
    if (!state.reciters.length) missing.push('audio/اسم القارئ/*.mp3 أو روابط audio/links.json');
    if (!state.fonts.some(f => f.fileName === 'myfont.ttf')) missing.push('assets/fonts/myfont.ttf');
    if (!missing.length) { $('dataAlert').classList.add('hidden'); return; }
    $('dataAlert').innerHTML = `التطبيق يعمل، لكن بعض ملفات المحتوى اختيارية وغير موجودة حاليًا: <strong>${missing.map(esc).join('، ')}</strong>.`;
    $('dataAlert').classList.remove('hidden');
  }

  function renderQuran(chapter, focusVerse = null) {
    chapter = clamp(Number(chapter) || 1, 1, 114);
    currentChapter = chapter;
    const verses = versesForChapter(chapter);
    $('surahSelect').value = String(chapter);
    $('surahKicker').textContent = `${t('ui.surah','السورة')} ${chapter}`;
    $('surahTitle').textContent = surahName(chapter);
    $('surahMeta').textContent = verses.length ? `${verses.length} آية` : t('dynamic.quran_missing','لا توجد بيانات لهذه السورة');
    const list = $('verses');
    if (!verses.length) { list.innerHTML = `<div class="notice">${esc(t('dynamic.quran_missing','لم يتم العثور على آيات لهذه السورة في ملف القرآن المحلي.'))}</div>`; updateSidebar(); return; }
    const token = ++chapterRenderToken;
    list.innerHTML = verses.map(v => {
      const key = `${v.chapter}:${v.verse}`, fav = state.app.favorites.some(x => x.key === key), note = String(state.app.notes[key] || ''), tr = state.translationMap[key], read = !!state.app.readVerses[key];
      return `<div class="verse ${read ? 'read-verse' : ''}" id="verse-${v.verse}" data-key="${esc(key)}"><div><span class="verse-number">${v.verse}</span><span class="verse-text">${esc(v.text)}</span></div>${tr ? `<div class="translation-text">${esc(tr)}</div>` : ''}<div class="verse-tools"><button class="mini-action read-btn ${read ? 'is-read' : ''}" data-key="${esc(key)}">${read ? '✓ تمت القراءة' : '☐ تعليم كمقروءة'}</button><button class="mini-action fav-btn" data-key="${esc(key)}">${fav ? '★ إزالة المفضلة' : '☆ مفضلة'}</button><button class="mini-action copy-btn" data-text="${esc(v.text)}">${esc(t('ui.copy','نسخ'))}</button><button class="mini-action note-btn" data-key="${esc(key)}">${note ? '📝 ' + t('ui.edit_note','تعديل الملاحظة') : '📝 ' + t('ui.add_note','ملاحظة')}</button></div></div>`;
    }).join('');
    list.querySelectorAll('.read-btn').forEach(b => b.addEventListener('click', () => toggleVerseRead(b.dataset.key)));
    list.querySelectorAll('.fav-btn').forEach(b => b.addEventListener('click', () => toggleFavorite(b.dataset.key)));
    list.querySelectorAll('.copy-btn').forEach(b => b.addEventListener('click', () => copyText(b.dataset.text)));
    list.querySelectorAll('.note-btn').forEach(b => b.addEventListener('click', () => editNote(b.dataset.key)));
    if (focusVerse) requestAnimationFrame(() => { if (token !== chapterRenderToken) return; const target = $(`verse-${focusVerse}`); if (target) { target.classList.add('current'); target.scrollIntoView({behavior:'smooth', block:'center'}); } });
    state.app.lastRead = { ...state.app.lastRead, chapter, verse: Number(focusVerse || state.app.lastRead.verse || 1) };
    updateSidebar();
  }

  async function toggleVerseRead(key) {
    const [chapter, verse] = key.split(':').map(Number); if (!Number.isFinite(chapter) || !Number.isFinite(verse)) return;
    const wasRead = !!state.app.readVerses[key], day = todayKey();
    if (wasRead) { delete state.app.readVerses[key]; state.app.readingLog[day] = Math.max(0, Number(state.app.readingLog[day] || 0) - 1); }
    else { state.app.readVerses[key] = true; state.app.readingLog[day] = Number(state.app.readingLog[day] || 0) + 1; }
    state.app.lastRead = {...state.app.lastRead, chapter, verse}; await persist(); renderQuran(chapter, verse); setToast(wasRead ? 'تم إلغاء تعليم الآية كمقروءة' : 'تم تعليم الآية كمقروءة');
  }

  async function openVerse(chapter, verse) { chapter = Number(chapter); verse = Number(verse) || 1; state.app.lastRead = {...state.app.lastRead, chapter, verse}; await persist(); renderQuran(chapter, verse); showView('quran'); updateSidebar(); }
  async function toggleFavorite(key) { const [chapter, verse] = key.split(':').map(Number); const exists = state.app.favorites.some(x => x.key === key); if (exists) state.app.favorites = state.app.favorites.filter(x => x.key !== key); else { const v = versesForChapter(chapter).find(x => x.verse === verse); if (v) state.app.favorites.push({key, chapter, verse, text:v.text, addedAt:new Date().toISOString()}); } await persist(); renderQuran(chapter, verse); renderFavorites(); setToast(exists ? 'تمت إزالة المفضلة' : 'تمت الإضافة إلى المفضلة'); }
  async function copyText(text) { await window.quranAPI.copyText(text); setToast(t('dynamic.copied','تم النسخ إلى الحافظة')); }

  function openModal(id) { const modal=$(id); modal.classList.remove('hidden'); modal.setAttribute('aria-hidden','false'); }
  function closeModal(id) { const modal=$(id); modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }

  function editNote(key) {
    const [chapter, verse] = key.split(':').map(Number), q = versesForChapter(chapter).find(v => v.verse === verse);
    if (!q) { setToast('لا يمكن إضافة ملاحظة قبل توفر آية'); return; }
    noteKey = key; $('noteModalTitle').textContent = state.app.notes[key] ? t('ui.edit_note','تعديل الملاحظة') : t('ui.add_note','ملاحظة'); $('noteVersePreview').textContent = `${surahName(chapter)} — آية ${verse}\n${q.text}`; $('noteInput').value = state.app.notes[key] || ''; $('deleteNoteBtn').classList.toggle('hidden', !state.app.notes[key]); openModal('noteModal'); setTimeout(() => $('noteInput').focus(), 0);
  }

  async function saveNote() {
    if (!noteKey) return; const value = $('noteInput').value.trim(); if (value) state.app.notes[noteKey] = value; else delete state.app.notes[noteKey]; await persist(); closeModal('noteModal'); renderQuran(...noteKey.split(':').map(Number)); renderFavorites(); setToast(value ? t('dynamic.note_saved','تم حفظ الملاحظة') : t('dynamic.note_deleted','تم حذف الملاحظة')); noteKey = null;
  }

  async function deleteNote() { if (!noteKey) return; delete state.app.notes[noteKey]; await persist(); closeModal('noteModal'); renderFavorites(); renderQuran(state.app.lastRead.chapter, state.app.lastRead.verse); setToast(t('dynamic.note_deleted','تم حذف الملاحظة')); noteKey = null; }

  function updateSidebar() {
    const lr = state.app.lastRead || {chapter:1, verse:1}; $('sidebarLastRead').textContent = `${surahName(lr.chapter)} — آية ${lr.verse}${lr.page ? ` — صفحة ${lr.page}` : ''}`;
    const count = Number(state.app.readingLog[todayKey()] || 0), target = Math.max(1, Number(state.app.settings.dailyTarget || 5)); $('dailyProgressBar').style.width = `${clamp(Math.round(count / target * 100),0,100)}%`; $('dailyProgressText').textContent = `${count} / ${target} آيات`;
    let streak = 0, date = new Date(); while (true) { const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; if (Number(state.app.readingLog[key] || 0) <= 0) break; streak++; date.setDate(date.getDate()-1); if (streak > 3650) break; } $('dailyStreak').textContent = `${streak} يوم`;
  }

  async function saveReading(chapter, verse) { state.app.lastRead = {...state.app.lastRead, chapter:Number(chapter), verse:Number(verse)}; const k=todayKey(); state.app.readingLog[k]=Number(state.app.readingLog[k]||0)+1; await persist(); updateSidebar(); }

  function audioErrorText(audio) {
    const code = audio?.error?.code;
    if (code === 1) return 'تم إيقاف التحميل';
    if (code === 2) return 'فشل الاتصال بملف الصوت';
    if (code === 3) return 'تعذر فك ترميز ملف الصوت';
    if (code === 4) return 'صيغة الصوت غير مدعومة أو الرابط غير صالح';
    return 'تعذر تشغيل الملف الصوتي';
  }

  async function startAudioPlayback(audio) {
    try {
      await audio.play();
      $('audioStatus').textContent = `${state.app.settings.reciter} — ${surahName(currentAudioChapter)} — ${currentAudioSourceLabel === 'local' ? 'محلي' : 'من الإنترنت'}`;
      return true;
    } catch (error) {
      console.error('Audio play() failed:', error);
      $('audioStatus').textContent = `تعذر بدء التشغيل: ${error?.name || 'خطأ غير معروف'}`;
      return false;
    }
  }

  function setupAudio() {
    const audio = $('audio');
    $('audioSpeed').value='1'; audio.playbackRate=1;
    audio.addEventListener('loadedmetadata', () => {
      if (!currentAudioSourceLabel) $('audioStatus').textContent = t('ui.ready','جاهز');
    });
    audio.addEventListener('canplay', () => {
      const sourceLabel = currentAudioSourceLabel === 'local' ? 'محلي' : 'من الإنترنت';
      if (currentAudioChapter) $('audioStatus').textContent = `${state.app.settings.reciter} — ${surahName(currentAudioChapter)} — ${sourceLabel} — جاهز`;
    });
    audio.addEventListener('error', async () => {
      console.error('Audio element error:', audio.error);
      if (currentAudioRemoteFallback) {
        const fallback = currentAudioRemoteFallback;
        currentAudioRemoteFallback = null;
        currentAudioSourceLabel = 'remote';
        audio.src = fallback;
        audio.load();
        $('audioStatus').textContent = `${state.app.settings.reciter} — ${surahName(currentAudioChapter)} — تجربة المصدر الخارجي…`;
        if (state.app.settings.autoplay) await startAudioPlayback(audio);
        return;
      }
      $('audioStatus').textContent = audioErrorText(audio);
    });
    audio.addEventListener('timeupdate', () => { const s=Math.floor(audio.currentTime||0); $('audioTime').textContent=`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; });
    audio.addEventListener('ended', handleAudioEnded);
    $('audioSpeed').addEventListener('change', e => audio.playbackRate = Number(e.target.value));
  }

  async function loadAudio(chapter, autoplay=false) {
    const reciter = state.app.settings.reciter || state.reciters[0] || '';
    if (!reciter) { setToast('لا توجد تلاوة. ضع MP3 داخل audio/ أو أضف روابط إلى audio/links.json'); return false; }
    let info;
    try {
      info = await window.quranAPI.getAudio(reciter, Number(chapter));
    } catch (error) {
      console.error('getAudio failed:', error);
      $('audioStatus').textContent = 'تعذر تحديد ملف التلاوة';
      return false;
    }
    if (!info?.src) { setToast(`لا يوجد ملف أو رابط صوتي مطابق للسورة ${chapter}.`); return false; }
    const audio=$('audio');
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    currentAudioChapter=Number(chapter);
    currentAudioSourceLabel=info.source || 'local';
    currentAudioRemoteFallback=info.fallback || null;
    audio.src=info.src;
    audio.load();
    audio.playbackRate=1; $('audioSpeed').value='1';
    repeatLeft=Number(state.app.settings.repeatCount||1);
    const sourceLabel = info.source === 'local' ? 'محلي' : 'من الإنترنت';
    $('audioStatus').textContent=`${reciter} — ${surahName(chapter)} — ${sourceLabel} — تحميل…`;
    if (autoplay || state.app.settings.autoplay) await startAudioPlayback(audio);
    return true;
  }
  function setRepeatDisplay(){ const n=Number(state.app.settings.repeatCount||1); $('audioRepeatBtn').textContent=n===-1?'تكرار: ∞':`تكرار: ${n}×`; }
  async function handleAudioEnded(){ if(repeatLeft===-1 || repeatLeft>1){ if(repeatLeft>1) repeatLeft--; $('audio').currentTime=0; try{await $('audio').play()}catch{} return; } const current=Number(state.app.lastRead.chapter||1); if(state.app.settings.autoNext&&current<114){ const next=current+1; state.app.lastRead={...state.app.lastRead,chapter:next,verse:1}; renderQuran(next,1); await saveReading(next,1); await loadAudio(next,true); } }

  function renderHadith(filter='') {
    const q = normalizeSearch(filter);
    const items = state.hadith.filter(h => !q || normalizeSearch([h.text,h.source,h.book,h.chapter,h.narrator,h.reference].filter(Boolean).join(' ')).includes(q)).slice(0, 200);
    $('hadithNotice').classList.toggle('hidden', !!items.length || !!state.hadith.length);
    if (!state.hadith.length) { $('hadithNotice').textContent=t('dynamic.hadith_missing','ملف الأحاديث غير موجود أو لا يحتوي نصوصًا قابلة للعرض.'); $('hadithNotice').classList.remove('hidden'); $('hadithList').innerHTML=''; return; }
    if (!items.length) { $('hadithList').innerHTML=`<div class="notice">${esc(t('ui.no_results','لا توجد نتائج مطابقة.'))}</div>`; return; }
    $('hadithList').innerHTML=items.map(h=>`<article class="hadith-card"><div class="hadith-meta">${esc(h.source||h.book||t('ui.hadith','حديث'))}${h.narrator?` • ${esc(h.narrator)}`:''}${h.reference?` • ${esc(h.reference)}`:''}</div><div class="hadith-text">${htmlLines(h.text)}</div><div class="hadith-tools"><button class="mini-action hadith-copy" data-text="${esc(h.text)}">${esc(t('ui.copy','نسخ'))}</button></div></article>`).join('');
    $('hadithList').querySelectorAll('.hadith-copy').forEach(btn=>btn.addEventListener('click',()=>copyText(btn.dataset.text)));
  }

  function randomHadith(){ if(!state.hadith.length){setToast(t('dynamic.hadith_missing','ملف الأحاديث غير موجود'));return;} const h=state.hadith[Math.floor(Math.random()*state.hadith.length)]; $('hadithSearch').value=''; $('hadithList').innerHTML=`<article class="hadith-card random-highlight"><div class="hadith-meta">حديث عشوائي • ${esc(h.source||h.book||'')}</div><div class="hadith-text">${htmlLines(h.text)}</div><div class="hadith-tools"><button class="mini-action hadith-copy" data-text="${esc(h.text)}">${esc(t('ui.copy','نسخ'))}</button></div></article>`; $('hadithList').querySelector('.hadith-copy')?.addEventListener('click',()=>copyText(h.text)); }

  function renderFavorites(){
    const favs=state.app.favorites||[], notes=Object.entries(state.app.notes||{}); let html='';
    if(favs.length) html+=`<h3>المفضلة</h3>`+favs.map(i=>`<article class="favorite-card"><div class="favorite-head"><strong>${esc(surahName(i.chapter))} — ${i.verse}</strong><button class="mini-action remove-fav" data-key="${esc(i.key)}">${esc(t('ui.remove','إزالة'))}</button></div><div class="favorite-text">${esc(i.text)}</div><button class="mini-action open-fav" data-c="${i.chapter}" data-v="${i.verse}">${esc(t('ui.open_in_quran','فتح في المصحف'))}</button></article>`).join('');
    if(notes.length) html+=`<h3 style="margin-top:18px">${esc(t('ui.edit_note','الملاحظات'))}</h3>`+notes.map(([key,note])=>{const[c,v]=key.split(':').map(Number),q=versesForChapter(c).find(x=>x.verse===v); return `<article class="favorite-card"><div class="favorite-head"><strong>${esc(surahName(c))} — ${v}</strong><button class="mini-action edit-note" data-key="${esc(key)}">${esc(t('ui.edit_note','تعديل'))}</button></div><div class="favorite-text">${esc(q?.text||'')}</div><div class="muted note-body">${htmlLines(note)}</div></article>`;}).join('');
    $('favoritesList').innerHTML=html||`<div class="notice">${esc(t('ui.no_results','لا توجد مفضلات أو ملاحظات بعد.'))}</div>`;
    $('favoritesList').querySelectorAll('.remove-fav').forEach(b=>b.addEventListener('click',()=>toggleFavorite(b.dataset.key))); $('favoritesList').querySelectorAll('.open-fav').forEach(b=>b.addEventListener('click',()=>openVerse(Number(b.dataset.c),Number(b.dataset.v)))); $('favoritesList').querySelectorAll('.edit-note').forEach(b=>b.addEventListener('click',()=>editNote(b.dataset.key)));
  }

  function renderTasbih(){ const tasbih=state.app.tasbih; $('tasbihCount').textContent=tasbih.count; $('tasbihTargetLabel').textContent=tasbih.target; $('tasbihTotal').textContent=tasbih.total; }
  async function addTasbih(delta=1){ const tasbih=state.app.tasbih; tasbih.count=clamp(Number(tasbih.count||0)+delta,0,999999); if(delta>0)tasbih.total=Number(tasbih.total||0)+delta; await persist(); renderTasbih(); if(tasbih.count>=tasbih.target&&tasbih.target>0)setToast(`اكتمل هدف ${tasbih.target}`); }

  function searchData(query, filter='all') {
    const q=normalizeSearch(query); if(!q)return {quran:[],hadith:[]};
    const limitQ=Number(state.config?.search?.max_quran_results||50), limitH=Number(state.config?.search?.max_hadith_results||30);
    const quran = filter==='hadith' ? [] : flattenQuran(state.quran).filter(v => normalizeSearch(`${v.text} ${surahName(v.chapter)} ${v.chapter}:${v.verse}`).includes(q)).slice(0,limitQ);
    const hadith = filter==='quran' ? [] : state.hadith.filter(h => normalizeSearch([h.text,h.source,h.book,h.chapter,h.narrator,h.reference].filter(Boolean).join(' ')).includes(q)).slice(0,limitH);
    return {quran,hadith};
  }

  function renderSearchResults(){
    const query=$('searchInput').value, filter=$('searchFilter').value, result=searchData(query,filter); const total=result.quran.length+result.hadith.length; $('searchCount').textContent=query.trim()?`${total} نتيجة`:'اكتب كلمة للبحث';
    let html='';
    for(const v of result.quran) html+=`<button class="search-result" data-kind="quran" data-c="${v.chapter}" data-v="${v.verse}"><span class="result-type">القرآن</span><strong>${esc(surahName(v.chapter))} — آية ${v.verse}</strong><span>${esc(v.text)}</span></button>`;
    for(const h of result.hadith) html+=`<article class="search-result static"><span class="result-type">الأحاديث</span><strong>${esc(h.source||h.book||'حديث')}</strong><span>${htmlLines(h.text)}</span></article>`;
    $('searchResults').innerHTML=html|| (query.trim()?`<div class="notice">${esc(t('ui.no_results','لا توجد نتائج مطابقة.'))}</div>`:'<div class="search-empty">ابدأ بالكتابة للبحث في ملفاتك المحلية.</div>');
  }
  function openSearch(initial=''){ $('searchInput').value=initial; $('searchFilter').value='all'; openModal('searchModal'); renderSearchResults(); setTimeout(()=>{$('searchInput').focus();$('searchInput').select();},0); }

  function renderTools(){
    const tools=[['🔎','بحث شامل','ابحث في القرآن والأحاديث محليًا.','openSearch'],['📌','آخر موضع','العودة فورًا إلى آخر موضع قراءة.','continue'],['📝','ملاحظات','أضف ملاحظات خاصة لكل آية.','favorites'],['★','المفضلة','حفظ آيات مهمة في مكان واحد.','favorites'],['🎯','هدف يومي','تتبع عدد الآيات المقروءة يوميًا.','settings'],['🎧','مشغل التلاوة','تشغيل ملفات MP3 محلية.','quran'],['🔁','تكرار السورة','كرر التلاوة بالعدد المحدد.','quran'],['⏱','مؤقت نوم','إيقاف التلاوة تلقائيًا بعد مدة.','sleep'],['📖','الترجمات','عرض ترجمة المعاني من ملفات محلية.','quran'],['📦','نسخ احتياطي','تصدير الإعدادات والمفضلة والملاحظات.','backup'],['♻','استرجاع','استيراد نسخة احتياطية سابقة.','restore'],['🔤','حجم النص','ضبط حجم الآيات والتباعد.','font'],['🌙','الوضع الليلي','التبديل السريع بين المظهرين.','theme'],['📋','نسخ الآية','نسخ الآية إلى الحافظة.','quran'],['📊','إحصاءات','مشاهدة تقدمك المحلي.','stats'],['🧭','قِبلة محلية','حساب اتجاه القبلة بالإحداثيات يدويًا دون إنترنت.','qibla'],['⌨','اختصارات','تحكم بلوحة المفاتيح.','shortcuts'],['🗂','فتح البيانات','فتح مجلدات البيانات المحلية.','folders'],['🎲','حديث عشوائي','اختيار حديث عشوائي من الملف المحلي.','randomHadith']];
    $('toolsGrid').innerHTML=tools.map(([i,title,desc,action])=>`<article class="big-tool"><div><div class="big-tool-icon">${i}</div><h3>${title}</h3><p>${desc}</p></div><button class="secondary-btn tool-action" data-action="${action}">فتح</button></article>`).join('');
    $('toolsGrid').querySelectorAll('.tool-action').forEach(b=>b.addEventListener('click',()=>runTool(b.dataset.action)));
  }
  function runTool(action){ if(action==='quran')showView('quran'); else if(action==='continue')$('continueBtn').click(); else if(action==='favorites')showView('favorites'); else if(action==='settings')showView('settings'); else if(action==='theme')toggleTheme(); else if(action==='font'){showView('settings');$('fontUp').click();} else if(action==='randomHadith'){showView('hadith');randomHadith();} else if(action==='sleep')promptSleepTimer(); else if(action==='backup')$('exportBtn').click(); else if(action==='restore')$('importBtn').click(); else if(action==='openSearch')openSearch(); else if(action==='stats')showStats(); else if(action==='qibla')showQibla(); else if(action==='shortcuts')alert('N: التالية • P: السابقة • Space: تشغيل/إيقاف • F: وضع التركيز • Ctrl+K: بحث • Esc: إغلاق'); else if(action==='folders')window.quranAPI.openFolder('data'); }
  function toggleTheme(){ const current=state.app.settings.theme||'dark'; state.app.settings.theme=current==='dark'?'light':'dark'; applyTheme(); $('themeSelect').value=state.app.settings.theme; persist(); }

  function showStats(){ const days=Object.keys(state.app.readingLog||{}).length, verses=Object.values(state.app.readingLog||{}).reduce((a,b)=>a+Number(b||0),0); alert(`إحصاءات محلية\n\nأيام النشاط: ${days}\nإجمالي تسجيلات القراءة: ${verses}\nالمفضلة: ${state.app.favorites.length}\nالملاحظات: ${Object.keys(state.app.notes).length}\nإجمالي التسبيحات: ${state.app.tasbih.total}`); }
  function showQibla(){ const lat=Number(prompt('أدخل خط العرض (مثل 30.0444):')), lon=Number(prompt('أدخل خط الطول (مثل 31.2357):')); if(!Number.isFinite(lat)||!Number.isFinite(lon))return; const kaabaLat=21.422487,kaabaLon=39.826206,phi1=lat*Math.PI/180,phi2=kaabaLat*Math.PI/180,dLon=(kaabaLon-lon)*Math.PI/180,y=Math.sin(dLon),x=Math.cos(phi1)*Math.tan(phi2)-Math.sin(phi1)*Math.cos(dLon),bearing=(Math.atan2(y,x)*180/Math.PI+360)%360; alert(`اتجاه القبلة التقريبي: ${bearing.toFixed(1)}° من الشمال الحقيقي.`); }
  function promptSleepTimer(){ const minutes=Number(prompt('أوقف التلاوة بعد كم دقيقة؟ (0 للإلغاء)','30')); if(!Number.isFinite(minutes))return; clearTimeout(promptSleepTimer.timer); if(minutes<=0){setToast('تم إلغاء مؤقت النوم');return;} promptSleepTimer.timer=setTimeout(()=>{$('audio').pause();setToast('تم إيقاف التلاوة بواسطة المؤقت');},minutes*60000); setToast(`مؤقت النوم: ${minutes} دقيقة`); }
  function showView(name){ document.querySelectorAll('.view').forEach(v=>v.classList.remove('active-view')); const target=$(`view-${name}`); if(target)target.classList.add('active-view'); document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name)); $('sidebar').classList.remove('open'); }
  function renderAssistantReply(text){ const box=$('assistantMessages'), d=document.createElement('div'); d.className='assistant-bubble'; d.innerHTML=htmlLines(text); box.appendChild(d); box.scrollTop=box.scrollHeight; }
  function assistantAnswer(input){ const q=input.trim(); if(!q)return'اكتب سؤالًا أو كلمة للبحث.'; const l=normalizeSearch(q); if(l.includes('اخر قراءه')){const lr=state.app.lastRead;return`آخر موضع محفوظ: ${surahName(lr.chapter)} — الآية ${lr.verse}${lr.page?` — الصفحة ${lr.page}`:''}.`;} if(l.includes('المفضله'))return`لديك ${state.app.favorites.length} آية في المفضلة.`; if(l.includes('السبحه')||l.includes('التسبيح'))return`عداد السبحة الحالي ${state.app.tasbih.count} من هدف ${state.app.tasbih.target}.`; const result=searchData(q,'all'); if(result.quran.length)return`وجدت ${result.quran.length} نتائج في القرآن:\n${result.quran.slice(0,8).map(v=>`${surahName(v.chapter)} — آية ${v.verse}: ${v.text}`).join('\n')}`; if(result.hadith.length)return`وجدت ${result.hadith.length} أحاديث محلية:\n${result.hadith.slice(0,5).map(h=>h.text).join('\n')}`; return'لم أجد تطابقًا في الملفات المحلية. جرّب كلمة أقصر أو استخدم البحث الشامل.'; }

  function prayerMonthKey(date=new Date()){ const year=date.getFullYear(),month=date.getMonth()+1,method=Number(state.app.settings.prayerMethod||5),school=Number(state.app.settings.prayerSchool||0),loc=state.app.prayer.location; const locKey=loc?.mode==='coordinates'?`${Number(loc.latitude).toFixed(4)},${Number(loc.longitude).toFixed(4)}`:(loc?.address||''); return `${year}-${String(month).padStart(2,'0')}-m${method}-s${school}-${locKey}`; }
  function prayerMonthTitle(date){ return date.toLocaleDateString(state.locale?.meta?.locale||'ar-EG',{month:'long',year:'numeric'}).replace('،',''); }
  function cleanPrayerTime(value){ return String(value||'').replace(/\s*\([^)]*\)/g,'').trim(); }
  function normalizePrayerEntry(item){ return {date:item.date?.gregorian?.date||'',timestamp:item.date?.timestamp||'',gregorian:item.date?.gregorian||{},hijri:item.date?.hijri||{},timings:item.timings||{},meta:item.meta||{}}; }
  function currentTargetDateParts(tz){ try{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const out={};parts.forEach(p=>out[p.type]=p.value);return {year:+out.year,month:+out.month,day:+out.day,hour:+out.hour,minute:+out.minute,second:+out.second};}catch{return {year:new Date().getFullYear(),month:new Date().getMonth()+1,day:new Date().getDate(),hour:new Date().getHours(),minute:new Date().getMinutes(),second:new Date().getSeconds()};} }
  function selectedPrayerCache(){ return state.app.prayer.cache?.[prayerMonthKey(prayerMonthCursor)]||null; }
  function renderPrayer(){ const entry=selectedPrayerCache(),loc=state.app.prayer.location; $('prayerLocationLabel').textContent=loc?(loc.label||loc.address||'الموقع الحالي'):'لم يتم تحديد الموقع بعد'; $('prayerSetup').classList.toggle('hidden',!!loc); $('prayerMonthTitle').textContent=prayerMonthTitle(prayerMonthCursor); if(!entry){$('prayerTodayGrid').innerHTML='<div class="notice">لا توجد مواقيت مخزنة لهذا الشهر بعد. حدد موقعًا ثم حدّث الشهر عند الاتصال بالإنترنت.</div>';$('prayerMonthBody').innerHTML='';$('prayerUpdatedLabel').textContent='لا توجد بيانات مخزنة';$('prayerCacheInfo').textContent=loc?'الموقع محفوظ، ولا توجد نسخة لهذا الشهر.':'لا يوجد موقع محفوظ بعد';return;} const rows=(entry.data||[]).map(normalizePrayerEntry),tz=entry.meta?.timezone||rows[0]?.meta?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,now=currentTargetDateParts(tz),currentMonth=prayerMonthCursor.getFullYear()===now.year&&prayerMonthCursor.getMonth()+1===now.month,today=currentMonth?rows.find(r=>Number(r.gregorian?.day)===now.day&&Number(r.gregorian?.month?.number||r.gregorian?.month)===now.month&&Number(r.gregorian?.year)===now.year):null,todayRow=today||null; const prayers=[['Fajr','الفجر','🌅'],['Sunrise','الشروق','☀️'],['Dhuhr','الظهر','🕌'],['Asr','العصر','🌤️'],['Maghrib','المغرب','🌇'],['Isha','العشاء','🌙']]; $('prayerTodayGrid').innerHTML=todayRow?prayers.map(([k,n,ico])=>`<div class="prayer-card"><div class="prayer-icon">${ico}</div><div class="prayer-name">${n}</div><strong>${esc(cleanPrayerTime(todayRow.timings?.[k]))}</strong><div class="muted small-text">${esc(todayRow.gregorian?.weekday?.ar||todayRow.gregorian?.weekday?.en||'')}</div></div>`).join(''):'<div class="notice">تعذر تحديد يوم اليوم.</div>'; $('prayerMonthBody').innerHTML=rows.map(r=>`<tr class="${todayRow&&r.date===todayRow.date?'today-row':''}"><td>${esc(r.gregorian?.date||r.date)}</td><td>${esc(r.hijri?.date||'')}</td><td>${esc(cleanPrayerTime(r.timings?.Fajr))}</td><td>${esc(cleanPrayerTime(r.timings?.Sunrise))}</td><td>${esc(cleanPrayerTime(r.timings?.Dhuhr))}</td><td>${esc(cleanPrayerTime(r.timings?.Asr))}</td><td>${esc(cleanPrayerTime(r.timings?.Maghrib))}</td><td>${esc(cleanPrayerTime(r.timings?.Isha))}</td><td>${esc(cleanPrayerTime(r.timings?.Midnight))}</td></tr>`).join(''); $('prayerUpdatedLabel').textContent=`آخر تحديث: ${entry.fetchedAt?new Date(entry.fetchedAt).toLocaleString(state.locale?.meta?.locale||'ar-EG'):'—'} • ${tz}`; $('prayerCacheInfo').textContent=`مخزن محليًا: ${rows.length} يومًا`; updatePrayerCountdown(); }
  function findPrayerRowForLocalDate(entry,parts){const rows=(entry?.data||[]).map(normalizePrayerEntry);return rows.find(r=>Number(r.gregorian?.day)===parts.day&&Number(r.gregorian?.month?.number||r.gregorian?.month)===parts.month&&Number(r.gregorian?.year)===parts.year)||null;}
  function updatePrayerCountdown(){ if(!state.app?.prayer?.location||!selectedPrayerCache())return; const entry=selectedPrayerCache(),tz=entry.meta?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone,now=currentTargetDateParts(tz),row=findPrayerRowForLocalDate(entry,now),target=$('prayerTodayGrid'); if(!row||!target)return; const list=[['Fajr','الفجر'],['Dhuhr','الظهر'],['Asr','العصر'],['Maghrib','المغرب'],['Isha','العشاء']],nowMin=now.hour*60+now.minute+now.second/60; let upcoming=list.map(([k,n])=>{const t=cleanPrayerTime(row.timings?.[k]),m=t.match(/^(\d{1,2}):(\d{2})/);return [k,n,t,m?Number(m[1])*60+Number(m[2]):null];}).find(x=>x[3]!=null&&x[3]>nowMin); let old=target.querySelector('.prayer-next'); if(!upcoming){if(old)old.remove();return;} const diff=Math.max(0,upcoming[3]-nowMin),h=Math.floor(diff/60),m=Math.floor(diff%60),s=Math.floor((diff*60)%60),html=`<div class="prayer-next"><span>الصلاة القادمة</span><strong>${upcoming[1]} — ${upcoming[2]}</strong><b>متبقي ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}</b></div>`; if(old)old.outerHTML=html;else target.insertAdjacentHTML('afterbegin',html); }
  async function fetchPrayerForMonth(date,{silent=false,force=false}={}){const loc=state.app.prayer.location;if(!loc)return false;const key=prayerMonthKey(date);if(!force&&state.app.prayer.cache?.[key]){renderPrayer();return true;} if(!silent){$('prayerNotice').classList.remove('hidden');$('prayerNotice').textContent='جاري جلب مواقيت الشهر…';} try{const p={year:date.getFullYear(),month:date.getMonth()+1,method:Number(state.app.settings.prayerMethod||5),school:Number(state.app.settings.prayerSchool||0),midnightMode:state.app.settings.prayerMidnightMode,latitudeAdjustmentMethod:state.app.settings.prayerLatitudeAdjustment};if(loc.mode==='coordinates'){p.mode='coordinates';p.latitude=loc.latitude;p.longitude=loc.longitude;}else{p.mode='address';p.address=loc.address;}const result=await window.quranAPI.fetchPrayerMonth(p);state.app.prayer.cache[key]={...result,meta:result.data?.[0]?.meta||{}};state.app.prayer.lastUpdated=new Date().toISOString();await persist();if(!silent){ $('prayerNotice').textContent='تم تحديث مواقيت الشهر وحفظها محليًا.';setTimeout(()=>$('prayerNotice').classList.add('hidden'),2200);}renderPrayer();return true;}catch(error){console.warn('Prayer fetch failed',error);if(!silent){$('prayerNotice').textContent='تعذر الاتصال بالخادم. ستُستخدم البيانات المحلية إن كانت موجودة.';$('prayerNotice').classList.remove('hidden');}renderPrayer();return false;}}
  function tryBrowserLocation(){ if(prayerLocationAttempted||state.app.prayer.location||!navigator.geolocation){renderPrayer();return Promise.resolve(false);} prayerLocationAttempted=true; return new Promise(resolve=>navigator.geolocation.getCurrentPosition(async pos=>{const lat=Number(pos.coords.latitude),lon=Number(pos.coords.longitude);state.app.prayer.location={mode:'coordinates',latitude:lat,longitude:lon,label:'موقع الجهاز'};await persist();renderPrayer();await fetchPrayerForMonth(new Date(),{silent:true,force:true});resolve(true);},()=>{renderPrayer();resolve(false);},{enableHighAccuracy:false,timeout:8000,maximumAge:86400000})); }
  async function setPrayerCity(){const value=$('prayerCityInput').value.trim();if(!value){setToast('اكتب اسم المدينة أو الدولة');return;}state.app.prayer.location={mode:'address',address:value,label:value};await persist();prayerMonthCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderPrayer();await fetchPrayerForMonth(prayerMonthCursor,{silent:false,force:true});}
  async function useCurrentLocation(){prayerLocationAttempted=false;state.app.prayer.location=null;await persist();await tryBrowserLocation();if(!state.app.prayer.location)setToast('لم تتم مشاركة الموقع؛ أدخل المدينة يدويًا.');}
  async function refreshPrayerCurrent(){const current=new Date();prayerMonthCursor=new Date(current.getFullYear(),current.getMonth(),1);if(!state.app.prayer.location){await tryBrowserLocation();if(!state.app.prayer.location)return;}await fetchPrayerForMonth(prayerMonthCursor,{silent:false,force:true});}
  async function changePrayerMonth(delta){prayerMonthCursor=new Date(prayerMonthCursor.getFullYear(),prayerMonthCursor.getMonth()+delta,1);renderPrayer();if(state.app.prayer.location)await fetchPrayerForMonth(prayerMonthCursor,{silent:false,force:false});}
  async function savePrayerSettings(){state.app.settings.prayerMethod=Number($('prayerMethod').value);state.app.settings.prayerSchool=Number($('prayerSchool').value);state.app.prayer.cache={};await persist();await refreshPrayerCurrent();}

  async function checkAudio(){
    const reciter=state.app.settings.reciter||state.reciters[0];
    if(!reciter){$('audioCheckStatus').textContent='لا توجد تلاوة محلية أو خارجية لفحصها.';return;}
    const rows=await window.quranAPI.getAudioCheck(reciter);
    const local=rows.filter(x=>x.source==='local').length;
    const remote=rows.filter(x=>x.source==='remote').length;
    const missing=114-local-remote;
    $('audioCheckStatus').textContent=`${reciter}: محلي ${local}/114 • روابط خارجية ${remote}/114 • مفقود ${missing}/114. المحلي له الأولوية.`;
    if(missing===0)setToast('فحص التلاوة اكتمل: 114/114');
  }

  async function exportBackup(){const ok=await window.quranAPI.exportState(state.app);if(ok)$('backupStatus').textContent='تم تصدير النسخة الاحتياطية.';}
  async function importBackup(){const data=await window.quranAPI.importState();if(!data)return;state.app=data;ensureState();applyTheme();populateSelectors();renderAll();await persist();setToast('تم استيراد البيانات');}
  function renderSettings(){ $('themeSelect').value=state.app.settings.theme||'dark'; $('fontRange').value=state.app.settings.fontSize||30; $('lineRange').value=state.app.settings.lineHeight||2.1; $('dailyTarget').value=state.app.settings.dailyTarget||5; $('autoplayCheck').checked=!!state.app.settings.autoplay; $('autoNextCheck').checked=!!state.app.settings.autoNext; $('repeatCount').value=String(state.app.settings.repeatCount??1); $('uiLanguage').value=state.app.settings.language||'ar'; $('fontSelect').value=state.app.settings.arabicFont||'myfont.ttf'; setRepeatDisplay(); applyQuranFont(); }
  function renderAll(){renderAlert();updateSidebar();renderQuran(state.app.lastRead.chapter||1,state.app.lastRead.verse||1);renderHadith($('hadithSearch')?.value||'');renderTasbih();renderFavorites();renderTools();renderSettings();renderPrayer();}

  function bind(){
    $('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
    document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
    $('searchBtn').addEventListener('click',()=>openSearch()); $('lastReadBtn').addEventListener('click',()=>openVerse(state.app.lastRead.chapter,state.app.lastRead.verse)); $('continueBtn').addEventListener('click',()=>openVerse(state.app.lastRead.chapter,state.app.lastRead.verse));
    $('surahSelect').addEventListener('change',async e=>{const c=Number(e.target.value);state.app.lastRead={...state.app.lastRead,chapter:c,verse:1,page:null};renderQuran(c,1);await persist();await loadAudio(c,false);}); $('jumpBtn').addEventListener('click',()=>{const v=Number($('verseJump').value);if(v>0)openVerse(Number($('surahSelect').value),v);}); $('verseJump').addEventListener('keydown',e=>{if(e.key==='Enter')$('jumpBtn').click();}); $('markReadBtn').addEventListener('click',()=>saveReading(state.app.lastRead.chapter,state.app.lastRead.verse||1).then(()=>setToast('تم حفظ موضع القراءة')));
    $('prevSurahBtn').addEventListener('click',async()=>{const c=clamp(Number(state.app.lastRead.chapter)-1,1,114);state.app.lastRead={...state.app.lastRead,chapter:c,verse:1,page:null};renderQuran(c,1);await persist();await loadAudio(c,false);}); $('nextSurahBtn').addEventListener('click',async()=>{const c=clamp(Number(state.app.lastRead.chapter)+1,1,114);state.app.lastRead={...state.app.lastRead,chapter:c,verse:1,page:null};renderQuran(c,1);await persist();await loadAudio(c,false);}); $('playSurahBtn').addEventListener('click',()=>loadAudio(state.app.lastRead.chapter,true)); $('audioNextBtn').addEventListener('click',()=>$('nextSurahBtn').click());
    $('audioRepeatBtn').addEventListener('click',()=>{const opts=[1,2,3,5,-1],cur=Number(state.app.settings.repeatCount||1),idx=opts.indexOf(cur),n=opts[(idx+1)%opts.length];state.app.settings.repeatCount=n;repeatLeft=n;setRepeatDisplay();persist();}); $('reciterSelect').addEventListener('change',async e=>{state.app.settings.reciter=e.target.value;await persist();await loadAudio(state.app.lastRead.chapter,false);}); $('translationSelect').addEventListener('change',async e=>{state.app.settings.translation=e.target.value;await persist();await loadTranslation(e.target.value);});
    $('fontDown').addEventListener('click',()=>{state.app.settings.fontSize=clamp(Number(state.app.settings.fontSize||30)-2,20,46);applyTheme();persist();}); $('fontUp').addEventListener('click',()=>{state.app.settings.fontSize=clamp(Number(state.app.settings.fontSize||30)+2,20,46);applyTheme();persist();}); $('lineDown').addEventListener('click',()=>{state.app.settings.lineHeight=clamp(Number(state.app.settings.lineHeight||2.1)-.1,1.5,3);applyTheme();persist();}); $('lineUp').addEventListener('click',()=>{state.app.settings.lineHeight=clamp(Number(state.app.settings.lineHeight||2.1)+.1,1.5,3);applyTheme();persist();}); $('toggleFocusBtn').addEventListener('click',()=>document.body.classList.toggle('focus-mode')); $('themeBtn').addEventListener('click',toggleTheme);
    $('themeSelect').addEventListener('change',e=>{state.app.settings.theme=e.target.value;applyTheme();persist();}); $('fontRange').addEventListener('input',e=>{state.app.settings.fontSize=Number(e.target.value);applyTheme();}); $('fontRange').addEventListener('change',persist); $('lineRange').addEventListener('input',e=>{state.app.settings.lineHeight=Number(e.target.value);applyTheme();}); $('lineRange').addEventListener('change',persist); $('dailyTarget').addEventListener('change',e=>{state.app.settings.dailyTarget=clamp(Number(e.target.value)||5,1,1000);persist();updateSidebar();}); $('autoplayCheck').addEventListener('change',e=>{state.app.settings.autoplay=e.target.checked;persist();}); $('autoNextCheck').addEventListener('change',e=>{state.app.settings.autoNext=e.target.checked;persist();}); $('repeatCount').addEventListener('change',e=>{state.app.settings.repeatCount=Number(e.target.value);repeatLeft=state.app.settings.repeatCount;setRepeatDisplay();persist();});
    $('openDataFolder').addEventListener('click',()=>window.quranAPI.openFolder('data')); $('openAudioFolder').addEventListener('click',()=>window.quranAPI.openFolder('audio')); $('exportBtn').addEventListener('click',exportBackup); $('importBtn').addEventListener('click',importBackup); $('hadithSearch').addEventListener('input',e=>renderHadith(e.target.value)); $('hadithRandomBtn').addEventListener('click',randomHadith);
    $('tasbihTarget').addEventListener('change',async()=>{state.app.tasbih.target=Number($('tasbihTarget').value);state.app.tasbih.count=0;await persist();renderTasbih();}); $('tasbihAdd').addEventListener('click',()=>addTasbih(1)); $('tasbihMinus').addEventListener('click',()=>addTasbih(-1)); $('tasbihReset').addEventListener('click',async()=>{state.app.tasbih.count=0;await persist();renderTasbih();}); document.querySelectorAll('.dhikr-preset').forEach(b=>b.addEventListener('click',()=>{$('selectedDhikr').textContent=b.dataset.dhikr;}));
    $('useLocationBtn').addEventListener('click',useCurrentLocation); $('refreshPrayerBtn').addEventListener('click',refreshPrayerCurrent); $('savePrayerCityBtn').addEventListener('click',setPrayerCity); $('prayerCityInput').addEventListener('keydown',e=>{if(e.key==='Enter')setPrayerCity();}); $('changePrayerLocationBtn').addEventListener('click',async()=>{state.app.prayer.location=null;await persist();prayerLocationAttempted=false;renderPrayer();}); $('openPrayerDataBtn').addEventListener('click',()=>window.quranAPI.openFolder('data')); $('prayerPrevMonth').addEventListener('click',()=>changePrayerMonth(-1)); $('prayerNextMonth').addEventListener('click',()=>changePrayerMonth(1)); $('savePrayerSettingsBtn').addEventListener('click',savePrayerSettings);
    $('fontSelect').addEventListener('change',async e=>{state.app.settings.arabicFont=e.target.value;await persist();await applyQuranFont();}); $('importFontBtn').addEventListener('click',async()=>{const font=await window.quranAPI.chooseFont();if(!font)return;state.fonts=state.fonts.filter(f=>f.fileName!==font.fileName);state.fonts.push(font);state.app.settings.arabicFont=font.fileName;populateSelectors();await persist();await applyQuranFont();setToast('تم استيراد الخط المحلي');}); $('openFontsFolder').addEventListener('click',()=>window.quranAPI.openFolder('fonts')); $('checkAudioBtn').addEventListener('click',checkAudio);
    $('openConfigFolder').addEventListener('click',()=>window.quranAPI.openFolder('config')); $('openLocalesFolder').addEventListener('click',()=>window.quranAPI.openFolder('locales')); $('openTranslationsFolder').addEventListener('click',()=>window.quranAPI.openFolder('translations'));
    $('uiLanguage').addEventListener('change',e=>applyLanguage(e.target.value));
    $('searchCloseBtn').addEventListener('click',()=>closeModal('searchModal')); $('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(renderSearchResults,90);}); $('searchFilter').addEventListener('change',renderSearchResults); $('searchResults').addEventListener('click',e=>{const btn=e.target.closest('.search-result[data-kind="quran"]');if(!btn)return;closeModal('searchModal');openVerse(Number(btn.dataset.c),Number(btn.dataset.v));});
    $('noteCloseBtn').addEventListener('click',()=>closeModal('noteModal')); $('cancelNoteBtn').addEventListener('click',()=>closeModal('noteModal')); $('saveNoteBtn').addEventListener('click',saveNote); $('deleteNoteBtn').addEventListener('click',deleteNote);
    document.querySelectorAll('.modal').forEach(m=>m.addEventListener('mousedown',e=>{if(e.target===m)m.classList.add('hidden');}));
    document.addEventListener('keydown',e=>{const tag=document.activeElement?.tagName;if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();} if(e.key==='Escape'){document.querySelectorAll('.modal').forEach(m=>m.classList.add('hidden'));$('sidebar').classList.remove('open');} if(e.key.toLowerCase()==='f'&&!['INPUT','TEXTAREA','SELECT'].includes(tag))document.body.classList.toggle('focus-mode'); if(e.code==='Space'&&!['INPUT','TEXTAREA','SELECT'].includes(tag)){e.preventDefault();const a=$('audio');if(a.paused)a.play();else a.pause();} if(e.key.toLowerCase()==='n'&&!['INPUT','TEXTAREA','SELECT'].includes(tag))$('nextSurahBtn').click(); if(e.key.toLowerCase()==='p'&&!['INPUT','TEXTAREA','SELECT'].includes(tag))$('prevSurahBtn').click();});
    matchMedia('(prefers-color-scheme: light)').addEventListener?.('change',applyTheme);
  }

  function parseIniWeb(text) { const out={}, lines=String(text||'').split(/\r?\n/); let section=null; for(const raw of lines){const line=raw.trim(); if(!line||line.startsWith(';')||line.startsWith('#')) continue; const sm=line.match(/^\[([^\]]+)\]$/); if(sm){section=sm[1]; out[section] ||= {}; continue;} const m=line.match(/^([^=]+)=(.*)$/); if(!m) continue; if(section) out[section][m[1].trim()]=m[2].trim(); else out[m[1].trim()]=m[2].trim();} return out; }

  function flattenHadithWeb(data, inherited = {}, out = []) {
    const keys=['text','matn','arabic','arabicText','arabic_text','content','body','hadithText','hadith_text'];
    if(Array.isArray(data)){data.forEach(x=>flattenHadithWeb(x,inherited,out));return out;}
    if(!data || typeof data!=='object') return out;
    const textKey=keys.find(k=>typeof data[k]==='string' && data[k].trim());
    if(textKey){out.push({id:data.id??data.number??String(out.length+1),text:data[textKey].trim(),source:data.source??data.collection??data.book??inherited.source??'',book:data.book??inherited.book??'',chapter:data.chapter??inherited.chapter??'',narrator:data.narrator??data.rawi??data.narrator_name??'',reference:data.reference??data.ref??''});return out;}
    const ctx={source:data.source??data.collection??inherited.source,book:data.book??inherited.book,chapter:data.chapter??inherited.chapter};
    Object.entries(data).forEach(([k,v])=>{if(!['meta','metadata','info','description'].includes(k)) flattenHadithWeb(v,ctx,out);}); return out;
  }

  function installWebAPI() {
    if(window.quranAPI) return;
    if(!['http:','https:'].includes(location.protocol)) throw new Error('نسخة الويب يجب تشغيلها عبر HTTP/HTTPS، وليس file://');
    document.body.classList.add('web-mode');
    let cachedData=null, audioLinks=null;
    const json=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}: ${url}`);return r.json();};
    const text=async url=>{const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`HTTP ${r.status}: ${url}`);return r.text();};
    const defaults=()=>({settings:{theme:'dark',language:'ar',fontSize:30,lineHeight:2.1,translation:'ar',reciter:'عبدالباسط عبدالصمد',repeatCount:1,autoplay:false,autoNext:true,dailyTarget:5,arabicFont:'myfont.ttf',prayerMethod:5,prayerSchool:0,prayerMidnightMode:'Standard',prayerLatitudeAdjustment:'ANGLE_BASED'},lastRead:{chapter:1,verse:1,page:null},favorites:[],notes:{},readingLog:{},readVerses:{},tasbih:{count:0,target:33,total:0},prayer:{location:null,cache:{},lastUpdated:null}});
    const loadState=()=>{try{return JSON.parse(localStorage.getItem('quran-offline-state')||'null')||defaults();}catch{return defaults();}};
    window.quranAPI={
      getData:async()=>{if(cachedData)return cachedData; const [quran,hadith,cfg,ar,audio]=await Promise.all([json('data/quran.json'),json('data/hadith.json'),text('config/settings.ini'),text('locales/ar.ini'),json('audio/links.json')]); audioLinks=audio; cachedData={quran,hadith:flattenHadithWeb(hadith),reciters:(audio.reciters||[]).map(r=>r.name).filter(Boolean),translations:['en','bn','es','fr','id','ru','sv','tr','ur','zh'],fonts:[{name:'myfont',fileName:'myfont.ttf',url:'assets/fonts/myfont.ttf',builtin:true}],languages:['ar','en','bn','es','fr','id','ru','sv','tr','ur','zh'],config:parseIniWeb(cfg),state:loadState(),prayerMethods:[{id:3,name:'رابطة العالم الإسلامي'},{id:4,name:'أم القرى، مكة'},{id:5,name:'هيئة المساحة المصرية'},{id:2,name:'ISNA'}]}; return cachedData;},
      getLanguage:code=>text(`locales/${encodeURIComponent(code)}.ini`).then(parseIniWeb),
      getTranslation:code=>code==='ar'?Promise.resolve({}):json(`translations/${encodeURIComponent(code)}.json`).then(normalizeTranslation),
      getAudio:async(reciter,chapter)=>{const list=audioLinks?.reciters||[]; const item=list.find(r=>String(r.name)===String(reciter))||list[0]; if(!item)return null; const tpl=item.template||item.urlTemplate||''; const n=Number(chapter); const src=tpl?tpl.replaceAll('{chapter}',String(n)).replaceAll('{chapter2}',String(n).padStart(2,'0')).replaceAll('{chapter3}',String(n).padStart(3,'0')):''; const fallbackTpl=item.fallbackTemplate||''; const fallback=fallbackTpl?fallbackTpl.replaceAll('{chapter}',String(n)).replaceAll('{chapter2}',String(n).padStart(2,'0')).replaceAll('{chapter3}',String(n).padStart(3,'0')):null; return src?{src,source:'remote',file:null,reciter:item.name,fallback}:null;},
      getAudioCheck:async reciter=>{const item=(audioLinks?.reciters||[]).find(r=>String(r.name)===String(reciter))||audioLinks?.reciters?.[0]; return Array.from({length:114},(_,i)=>({chapter:i+1,source:item?.template?'remote':null,file:null,url:item?.template?item.template.replaceAll('{chapter}',String(i+1)).replaceAll('{chapter2}',String(i+1).padStart(2,'0')).replaceAll('{chapter3}',String(i+1).padStart(3,'0')):null}));},
      saveState:st=>{localStorage.setItem('quran-offline-state',JSON.stringify(st));return Promise.resolve(true);},
      copyText:async value=>{try{await navigator.clipboard.writeText(String(value||''));}catch{const ta=document.createElement('textarea');ta.value=String(value||'');document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();}return true;},
      fetchPrayerMonth:async p=>{const q=new URLSearchParams({method:String(p.method||5),school:String(p.school||0),midnightMode:String(p.midnightMode||'Standard'),latitudeAdjustmentMethod:String(p.latitudeAdjustmentMethod||'ANGLE_BASED')}); const url=p.mode==='coordinates'?`https://api.aladhan.com/v1/calendar/${p.year}/${p.month}?latitude=${encodeURIComponent(p.latitude)}&longitude=${encodeURIComponent(p.longitude)}&${q}`:`https://api.aladhan.com/v1/calendarByAddress/${p.year}/${p.month}?address=${encodeURIComponent(p.address)}&${q}`; const r=await fetch(url); if(!r.ok)throw new Error(`HTTP ${r.status}`); const result=await r.json(); if(result.code!==200)throw new Error(result.status||'تعذر جلب المواقيت'); return {source:'AlAdhan',endpoint:url,fetchedAt:new Date().toISOString(),data:result.data};},
      getPrayerMethods:async()=>cachedData?.prayerMethods||[], chooseFont:async()=>null, openFolder:async()=>false, importState:async()=>null, exportState:async payload=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));a.download='quran-app-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);return true;}, quit:()=>{}
    };
  }

  async function loadTranslation(code){ if(code==='ar'){state.translationMap={};renderQuran(currentChapter,state.app.lastRead.verse);return;} state.translationMap=await window.quranAPI.getTranslation(code); renderQuran(currentChapter,state.app.lastRead.verse); }

  async function init(){
    installWebAPI();
    bind();
    const data=await window.quranAPI.getData();
    state.quran=data.quran||{}; state.hadith=data.hadith||[]; state.reciters=data.reciters||[]; state.translations=data.translations||[]; state.fonts=data.fonts||[]; state.languages=data.languages||['ar']; state.prayerMethods=data.prayerMethods||[]; state.config=data.config||{}; state.app=data.state||{};
    ensureState(); applyTheme(); populateSelectors();
    const lang=state.app.settings.language||state.config?.app?.default_language||'ar'; const locale=await window.quranAPI.getLanguage(lang); if(locale){state.locale=locale;state.localeCode=lang;} else {state.locale=await window.quranAPI.getLanguage('ar');state.localeCode='ar';state.app.settings.language='ar';}
    populateSelectors(); document.querySelectorAll('[data-i18n]').forEach(el=>{const val=t(el.dataset.i18n);if(val!==el.dataset.i18n)el.textContent=val;}); document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>el.placeholder=t(el.dataset.i18nPlaceholder,el.placeholder));
    renderAll(); if(state.app.settings.translation&&state.app.settings.translation!=='ar')await loadTranslation(state.app.settings.translation); repeatLeft=Number(state.app.settings.repeatCount||1); prayerCountdownTimer=setInterval(updatePrayerCountdown,1000);
    if(state.app.prayer.location){await fetchPrayerForMonth(new Date(),{silent:true,force:false});} else {renderPrayer();}
    applyQuranFont();
  }

  init().catch(error=>{console.error(error);setToast('حدث خطأ في تحميل التطبيق');});
})();