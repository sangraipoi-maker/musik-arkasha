/* ============================================================
   Musik Arkasha — pemutar musik pribadi
   Sumber: Internet Archive (streaming penuh) + YouTube (aliran
   audio via Piped; embed resmi hanya fallback per trek bila
   semua instance gagal). Semua data pengguna lokal.
   ============================================================ */
'use strict';

/* ---------------- util ---------------- */
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = sec => {
  sec = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(sec/3600), m = Math.floor(sec%3600/60), s = sec%60;
  return (h ? h+':' : '') + String(m).padStart(h?2:1,'0') + ':' + String(s).padStart(2,'0');
};
const keyOf = it => it.source + ':' + (it.source === 'archive' ? it.identifier + '/' + (it.file||'') : it.videoId);
/* Versi tayang: semua URL langsung (archive.org + Piped), tanpa proksi dev. */
const debounce = (fn, ms) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; };

/* ---------------- state ---------------- */
const store = {
  get(k, d){ try { const v = localStorage.getItem('ma_'+k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v){ try { localStorage.setItem('ma_'+k, JSON.stringify(v)); } catch {} },
};
const S = {
  results: [],            // hasil pencarian terakhir
  filter: 'all',
  queue: [],              // antrean putar
  idx: -1,                // indeks yang sedang dimainkan
  current: null,          // item yang sedang dimainkan
  playing: false,
  shuffle: false,
  repeat: 'off',          // off | all | one
  favs: store.get('favs', []),
  playlists: store.get('playlists', []),   // [{name, items:[...]}]
  history: store.get('history', []),
  pipedBase: null,
  playMode: null,        // audio | audio-direct | embed | resolving
  tab: 'results',
};
const isFav = it => S.favs.some(f => keyOf(f) === keyOf(it));

/* ---------------- elemen ---------------- */
/* Elemen utama terhubung ke Web Audio/analyser. Elemen direct hanya
   dipakai bila CORS aliran menolak tap analyser: musik tidak boleh
   ikut gagal hanya karena visualizer tidak bisa membaca audionya. */
const audioMain = $('#audio');
const audioDirect = $('#audioDirect');
let audio = audioMain;
const els = {
  status: $('#status'), resultsList: $('#resultsList'), resultsMeta: $('#resultsMeta'),
  queueList: $('#queueList'), queueCount: $('#queueCount'),
  favList: $('#favList'), historyList: $('#historyList'), playlistWrap: $('#playlistWrap'),
  npTitle: $('#npTitle'), npArtist: $('#npArtist'), npThumb: $('#npThumb'), npSource: $('#npSource'),
  seek: $('#seek'), tCur: $('#tCur'), tDur: $('#tDur'),
  btnPlay: $('#btnPlay'), icPlay: $('#icPlay'), icPause: $('#icPause'),
  liveBadge: $('#liveBadge'), vizNote: $('#vizNote'), ytMount: $('#ytMount'),
  pipedStatus: $('#pipedStatus'), debug: $('#debugbar'),
};
function setStatus(msg, isErr=false){
  els.status.textContent = msg || '';
  els.status.classList.toggle('err', !!isErr);
}
const audioBacked = () => S.playMode === 'audio' || S.playMode === 'audio-direct';
const audioTapActive = () => S.playMode === 'audio' && !!analyser;
function selectAudio(kind){
  const target = kind === 'direct' ? audioDirect : audioMain;
  if (audio !== target) {
    try { audio.pause(); } catch {}
    audio = target;
  }
  audio.volume = Number($('#vol').value || 80) / 100;
  return audio;
}
function pauseAllAudio(){
  [audioMain, audioDirect].forEach(el => { try { el.pause(); } catch {} });
}
function hostLabel(url){
  try { return new URL(url).host; } catch { return url; }
}

/* ============================================================
   SUMBER 1 — Internet Archive (API resmi, tanpa kunci)
   ============================================================ */
const iaResolveCache = new Map();   // identifier -> Promise<item|null>

async function iaSearch(q){
  const u = new URL('https://archive.org/advancedsearch.php');
  u.searchParams.set('q', `(title:(${q}) OR creator:(${q})) AND mediatype:audio`);
  ['identifier','title','creator','date'].forEach(f => u.searchParams.append('fl[]', f));
  u.searchParams.set('rows', '24'); u.searchParams.set('page', '1'); u.searchParams.set('output', 'json');
  const r = await fetch((u.toString()));
  if (!r.ok) throw new Error('Archive HTTP ' + r.status);
  const d = await r.json();
  return (d.response?.docs || []).map(doc => ({
    source: 'archive',
    identifier: doc.identifier,
    title: doc.title || doc.identifier,
    artist: doc.creator || 'Internet Archive',
    duration: null, file: null, streamUrl: null,
    thumb: (`https://archive.org/services/img/${doc.identifier}`),
    resolved: false, playable: null,
  }));
}

function iaPickFile(files){
  // berkas bertanda private:'true' di metadata Archive = dibatasi (401 untuk anonim) — lewati
  const cands = (files || []).filter(f => /\.(mp3|ogg)$/i.test(f.name || '') && f.private !== 'true');
  if (!cands.length) return null;
  const score = f => {
    let s = 0;
    if (/mp3/i.test(f.format || '')) s += 4;
    if ((f.source || '') === 'original') s += 2;
    const sz = Number(f.size || 0);
    if (sz > 100_000 && sz < 80_000_000) s += 1;
    if (/sample|preview/i.test(f.name)) s -= 3;
    return s;
  };
  cands.sort((a,b) => score(b) - score(a) || a.name.localeCompare(b.name));
  return cands[0];
}

function iaResolve(item){
  if (iaResolveCache.has(item.identifier)) return iaResolveCache.get(item.identifier);
  const p = (async () => {
    try {
      const r = await fetch((`https://archive.org/metadata/${encodeURIComponent(item.identifier)}`));
      if (!r.ok) throw new Error('meta ' + r.status);
      const d = await r.json();
      const f = iaPickFile(d.files);
      if (!f) { item.playable = false; item.resolved = true; return item; }
      item.file = f.name;
      if (f.title) item.title = f.title;
      if (f.artist) item.artist = f.artist;
      item.duration = parseFloat(f.length) || item.duration;
      item.streamUrl = ('https://archive.org/download/' + item.identifier + '/' +
        f.name.split('/').map(encodeURIComponent).join('/'));
      if (d.metadata?.title) item.title = d.metadata.title;
      if (d.metadata?.creator) item.artist = d.metadata.creator;
      item.playable = true; item.resolved = true;
      return item;
    } catch { item.playable = false; item.resolved = true; return item; }
  })();
  iaResolveCache.set(item.identifier, p);
  return p;
}

/* ============================================================
   SUMBER 2 — YouTube via Piped (aliran audio untuk putar;
   embed resmi hanya fallback bila semua instance gagal)
   ============================================================ */
const PIPED_INSTANCES = [
  'https://pipedapi.ducks.party',       // terverifikasi Kav dari VM, 17 Okt 2026
  'https://pipedapi.reallyaweso.me',
  'https://pipedapi.adminforge.de',
  'https://pipedapi.kavin.rocks',
  'https://pipedapi-libre.kavin.rocks',
  'https://pipedapi.leptons.xyz',
  'https://api.piped.private.coffee',
];
function pipedOrder(){
  const active = S.pipedBase;
  if (!active) return PIPED_INSTANCES.slice();
  const i = PIPED_INSTANCES.indexOf(active);
  if (i < 0) return [active, ...PIPED_INSTANCES];
  // mulai dari instance aktif, lalu lanjut berputar ke berikutnya
  return [...PIPED_INSTANCES.slice(i), ...PIPED_INSTANCES.slice(0, i)];
}
async function pipedJson(base, path, timeout=7000){
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(base + path, { signal: ctl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const d = await r.json();
    if (d && d.error) throw new Error(String(d.error).split('\n')[0].slice(0, 180));
    return d;
  } finally { clearTimeout(to); }
}
function markPipedActive(base){
  S.pipedBase = base;
  els.pipedStatus.textContent = 'Piped aktif: ' + base.replace('https://','');
}
async function pipedFetch(path){
  let lastErr = null;
  for (const base of pipedOrder()) {
    try {
      const d = await pipedJson(base, path);
      markPipedActive(base);
      return d;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('semua instance Piped gagal');
}
function pickAudioStream(streams){
  const cands = (streams || []).filter(s => s && s.url);
  if (!cands.length) return null;
  const typeOf = s => `${s.mimeType || ''} ${s.codec || ''} ${s.format || ''}`.toLowerCase();
  const codecRank = s => {
    const t = typeOf(s);
    if (/mp4|m4a|aac/.test(t)) return 4;   // target pertama: m4a/AAC
    if (/opus/.test(t)) return 3;          // target kedua: Opus
    if (/webm/.test(t)) return 2;
    if (/ogg|vorbis/.test(t)) return 1;
    return 0;
  };
  // Bitrate tertinggi yang masih wajar untuk musik: utamakan <=256 kbps;
  // di atas itu skornya turun perlahan, bukan menang mutlak karena besar.
  const rateScore = s => {
    const b = Number(s.bitrate || 0);
    if (!b) return 0;
    return b <= 256000 ? b : 256000 - Math.min(128000, (b - 256000) / 8);
  };
  return cands.slice().sort((a, b) =>
    codecRank(b) - codecRank(a) || rateScore(b) - rateScore(a))[0];
}
async function pipedStreams(base, videoId){
  const d = await pipedJson(base, `/streams/${encodeURIComponent(videoId)}`);
  const raw = pickAudioStream(d.audioStreams);
  if (!raw) throw new Error('audioStreams kosong');
  const stream = { ...raw, url: new URL(raw.url, base + '/').href };
  return { data: d, stream };
}
async function ytSearch(q){
  let d = await pipedFetch(`/search?q=${encodeURIComponent(q)}&filter=music_songs`);
  let items = (d.items || []).filter(i => i.type === 'stream');
  if (!items.length) {
    d = await pipedFetch(`/search?q=${encodeURIComponent(q)}&filter=all`);
    items = (d.items || []).filter(i => i.type === 'stream');
  }
  return items.slice(0, 20).map(i => ({
    source: 'youtube',
    videoId: (i.url || '').split('v=')[1] || '',
    title: i.title || '(tanpa judul)',
    artist: i.uploaderName || 'YouTube',
    duration: i.duration || null,
    thumb: (i.thumbnail || ''),
    playable: true, resolved: true,
  })).filter(i => i.videoId);
}

/* ============================================================
   Pencarian gabungan + rendering
   ============================================================ */
async function doSearch(q){
  q = (q || '').trim();
  if (!q) return;
  els.resultsMeta.innerHTML = '<span class="spinner"></span> Mencari di Internet Archive &amp; YouTube…';
  els.resultsList.innerHTML = '';
  setStatus('');
  const [ia, yt] = await Promise.allSettled([iaSearch(q), ytSearch(q)]);
  const iaItems = ia.status === 'fulfilled' ? ia.value : [];
  const ytItems = yt.status === 'fulfilled' ? yt.value : [];
  // gabungan satu daftar: YouTube dulu (paling relevan untuk lagu populer), lalu Archive
  S.results = [...ytItems, ...iaItems];
  const errs = [];
  if (ia.status === 'rejected') errs.push('Archive gagal (' + ia.reason.message + ')');
  if (yt.status === 'rejected') errs.push('YouTube/Piped gagal (' + yt.reason.message + ')');
  els.resultsMeta.textContent =
    `“${q}” — ${ytItems.length} dari YouTube · ${iaItems.length} dari Archive` +
    (errs.length ? ' · ⚠ ' + errs.join(' · ') : '');
  renderResults();
  // resolusi berkas Archive di latar (durasi + bisa-diputar), maks 4 paralel
  const pool = iaItems.slice();
  (async () => {
    const workers = Array.from({length: 4}, async () => {
      while (pool.length) { const it = pool.shift(); await iaResolve(it); updateRow(it); }
    });
    await Promise.all(workers);
  })();
  return S.results;
}

function badgeHTML(it){
  if (it.source === 'archive') {
    if (it.playable === false) return '<span class="mini-badge pending">Archive · tak ada berkas</span>';
    return '<span class="mini-badge archive">Archive · full</span>';
  }
  return '<span class="mini-badge youtube">YouTube</span>' +
    (it.embedFallback ? '<span class="mini-badge pending">embed</span>' : '');
}
function heartSVG(on){ return `<svg viewBox="0 0 24 24" width="19" height="19" fill="${on?'currentColor':'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`; }
const PLUS_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const LIST_SVG = '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" stroke-width="3"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

function rowHTML(it, ctx, idx){
  const cur = S.current && keyOf(S.current) === keyOf(it);
  return `<li class="track ${cur ? 'is-current' : ''} ${cur && S.playing ? 'is-playing' : ''}" data-ctx="${ctx}" data-idx="${idx}" tabindex="0" role="button" aria-label="Putar ${esc(it.title)}">
    ${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<img alt="" style="visibility:hidden">'}
    <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
    <div class="t-meta">
      <div class="t-title">${esc(it.title)}</div>
      <div class="t-sub">${badgeHTML(it)}<span>${esc(it.artist || '')}</span></div>
    </div>
    <span class="t-dur">${it.duration ? fmt(it.duration) : (it.source === 'archive' && !it.resolved ? '…' : '')}</span>
    <div class="t-actions">
      <button class="icon-btn ${isFav(it) ? 'is-fav' : ''}" data-act="fav" aria-label="Favorit" title="Favorit">${heartSVG(isFav(it))}</button>
      <button class="icon-btn" data-act="addq" aria-label="Tambah ke antrean" title="Tambah ke antrean">${PLUS_SVG}</button>
      <button class="icon-btn" data-act="addpl" aria-label="Tambah ke playlist" title="Tambah ke playlist">${LIST_SVG}</button>
      ${ctx === 'queue' ? `<button class="icon-btn" data-act="rmq" aria-label="Hapus dari antrean" title="Hapus">${X_SVG}</button>` : ''}
      ${ctx.startsWith('playlist:') ? `<button class="icon-btn" data-act="rmpl" aria-label="Hapus dari playlist" title="Hapus">${X_SVG}</button>` : ''}
    </div>
  </li>`;
}
function renderList(ul, items, ctx){
  ul.innerHTML = items.length
    ? items.map((it, i) => rowHTML(it, ctx, i)).join('')
    : '<li class="empty">Kosong.</li>';
}
function renderResults(){
  const items = S.results.filter(it => S.filter === 'all' || it.source === S.filter);
  renderList(els.resultsList, items, 'results');
  // simpan peta indeks hasil-terfilter agar klik akurat
  els.resultsList._items = items;
}
function renderQueue(){
  renderList(els.queueList, S.queue, 'queue');
  els.queueList._items = S.queue;
  els.queueCount.textContent = S.queue.length ? `(${S.queue.length})` : '';
}
function renderFavs(){
  renderList(els.favList, S.favs, 'favs');
  els.favList._items = S.favs;
}
function renderHistory(){
  renderList(els.historyList, S.history, 'history');
  els.historyList._items = S.history;
}
function renderPlaylists(){
  if (!S.playlists.length) {
    els.playlistWrap.innerHTML = '<div class="empty">Belum ada playlist. Buat di atas, atau klik ikon daftar pada lagu.</div>';
    return;
  }
  els.playlistWrap.innerHTML = S.playlists.map((pl, pi) => `
    <div class="pl-block">
      <h3>${esc(pl.name)} <span class="pl-count">${pl.items.length} lagu</span><span class="spacer"></span>
        <button class="btn btn-mini" data-plact="play" data-pi="${pi}">Putar</button>
        <button class="btn btn-mini" data-plact="del" data-pi="${pi}">Hapus</button>
      </h3>
      <ul class="tracklist" data-plist="${pi}">${pl.items.length ? pl.items.map((it, i) => rowHTML(it, 'playlist:' + pi, i)).join('') : '<li class="empty">Kosong.</li>'}</ul>
    </div>`).join('');
  $$('#playlistWrap [data-plist]').forEach(ul => { ul._items = S.playlists[+ul.dataset.plist].items; });
}
function renderAll(){ renderResults(); renderQueue(); renderFavs(); renderHistory(); renderPlaylists(); }
function updateRow(it){
  // perbarui baris hasil Archive sesudah resolusi latar selesai
  if (S.tab !== 'results') return;
  const items = els.resultsList._items || [];
  const i = items.indexOf(it);
  if (i < 0) return;
  const li = els.resultsList.children[i];
  if (li) li.outerHTML = rowHTML(it, 'results', i);
}

/* ============================================================
   Pemutar — Archive & YouTube lewat elemen <audio> yang sama;
   embed IFrame hanya fallback terakhir untuk satu trek YouTube
   bila seluruh rantai aliran Piped gagal.
   ============================================================ */
let ytPlayer = null, ytReady = false, ytWanted = null;
let playToken = 0;
let ytAttempt = null; // {token,item,order,pos,stream,stage,advancing}
window.onYouTubeIframeAPIReady = () => { ytReady = true; if (ytWanted) ytLoad(ytWanted); };
(function loadYT(){
  const tag = document.createElement('script');
  tag.src = 'https://www.youtube.com/iframe_api';
  tag.onerror = () => setStatus('API embed YouTube gagal dimuat (jaringan). Trek Archive tetap bisa diputar.', true);
  document.head.appendChild(tag);
})();
function ytLoad(videoId){
  ytWanted = videoId;
  if (!ytReady) return;
  if (ytPlayer) { ytPlayer.loadVideoById(videoId); return; }
  ytPlayer = new YT.Player('ytPlayer', {
    width: '100%', height: '100%',
    videoId,
    playerVars: { autoplay: 1, playsinline: 1, rel: 0 },
    events: {
      onStateChange: e => {
        if (!window.YT) return;
        if (e.data === YT.PlayerState.PLAYING) setPlaying(true);
        else if (e.data === YT.PlayerState.PAUSED) setPlaying(false);
        else if (e.data === YT.PlayerState.ENDED) { setPlaying(false); onEnded(); }
      },
      onError: () => setStatus('YouTube menolak memutar video ini (embed dibatasi pemiliknya). Coba hasil lain.', true),
    },
  });
}
function ytEmbedActive(){ return !!S.current && S.current.source === 'youtube' && S.playMode === 'embed'; }
function stopEmbed(){
  els.ytMount.hidden = true;
  if (ytPlayer && ytPlayer.pauseVideo) try { ytPlayer.pauseVideo(); } catch {}
}
function ytGetTime(){
  try { return ytPlayer && ytPlayer.getCurrentTime ? ytPlayer.getCurrentTime() : 0; } catch { return 0; }
}
function ytGetDur(){
  try { return (ytPlayer && ytPlayer.getDuration && ytPlayer.getDuration()) || (S.current && S.current.duration) || 0; } catch { return 0; }
}

function setPlaying(on){
  S.playing = on;
  els.icPlay.hidden = on; els.icPause.hidden = !on;
  els.liveBadge.hidden = !on;
  $$('.track.is-current').forEach(li => li.classList.toggle('is-playing', on));
  msSyncState();
}
function pushHistory(it){
  S.history = [it, ...S.history.filter(h => keyOf(h) !== keyOf(it))].slice(0, 30);
  store.set('history', S.history); renderHistory();
}
function refreshPlaybackChrome(){
  const it = S.current;
  if (!it) return;
  els.npSource.hidden = false;
  let label = 'Archive · full';
  if (it.source === 'youtube') {
    label = S.playMode === 'embed' ? 'YouTube · embed'
      : S.playMode === 'resolving' ? 'YouTube · audio …'
      : 'YouTube · audio';
  }
  els.npSource.textContent = label;
  els.npSource.className = 'src-badge ' + it.source + (S.playMode === 'embed' ? ' embed' : '');

  if (it.source === 'youtube' && S.playMode === 'embed') {
    els.vizNote.textContent = 'Semua aliran audio Piped gagal untuk trek ini — diputar lewat embed resmi YouTube. Iklan & perilaku latar mengikuti YouTube; visual reaktif semu.';
    els.vizNote.hidden = false;
  } else if (it.source === 'youtube' && S.playMode === 'audio-direct') {
    els.vizNote.textContent = 'Aliran YouTube ini menolak tap analyser (CORS) — musik tetap diputar penuh, visualnya reaktif semu untuk trek ini.';
    els.vizNote.hidden = false;
  } else {
    els.vizNote.hidden = true;
  }
  msSetMetadata(it);
}
function beginCurrent(it){
  els.npTitle.textContent = it.title;
  els.npArtist.textContent = it.artist || '';
  if (it.thumb) { els.npThumb.src = it.thumb; els.npThumb.hidden = false; } else els.npThumb.hidden = true;
  document.title = '▶ ' + it.title + ' — Musik Arkasha';
  pushHistory(it);
  refreshPlaybackChrome();
  renderAll();
}
/* Probe CORS yang jujur: fetch mode cors HANYA berhasil dibuka browser
   bila server mengizinkan origin ini. Range kecil + abort sesudah header
   agar tidak mengunduh berkas utuh. Gagal probe != musik gagal: putar
   langsung tanpa tap analyser. */
async function probeCors(url){
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 6000);
  try {
    await fetch(url, {
      mode: 'cors', credentials: 'omit', cache: 'no-store',
      headers: { Range: 'bytes=0-0' }, signal: ctl.signal,
    });
    ctl.abort();
    return true;
  } catch { return false; }
  finally { clearTimeout(to); }
}
async function startAudioPlayback(item, url, { tapped=true, attempt=null } = {}){
  const target = selectAudio(tapped ? 'main' : 'direct');
  const stage = tapped ? 'tapped' : 'direct';
  S.playMode = tapped ? 'audio' : 'audio-direct';
  item.embedFallback = false;
  if (tapped) {
    target.setAttribute('crossorigin', 'anonymous');
    ensureAudioCtx();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
  } else {
    target.removeAttribute('crossorigin');
  }
  target.src = url;
  target.volume = Number($('#vol').value || 80) / 100;
  refreshPlaybackChrome();
  try {
    await target.play();
    return true;
  } catch (e) {
    if (attempt && S.current === item) {
      // Abaikan penolakan basi dari elemen/stage yang sudah digantikan.
      if (attempt.stage === stage && target === audio) void failYouTubeAttempt(e);
    } else if (S.current === item) {
      setStatus('Gagal memutar: ' + e.message, true);
    }
    return false;
  }
}
async function playYouTubeAudio(item, token){
  ytAttempt = {
    token, item, order: pipedOrder(), pos: 0,
    stream: null, stage: null, advancing: false, lastError: null,
  };
  await tryNextYouTubeInstance(token);
}
async function tryNextYouTubeInstance(token){
  const att = ytAttempt;
  if (!att || att.token !== token || att.token !== playToken || S.current !== att.item) return;
  if (att.pos >= att.order.length) {
    const item = att.item;
    ytAttempt = null;
    fallbackToEmbed(item);
    return;
  }
  const base = att.order[att.pos++];
  att.base = base; att.stream = null; att.stage = null; att.advancing = false;
  S.playMode = 'resolving';
  refreshPlaybackChrome();
  setStatus('Mengambil aliran audio YouTube via ' + hostLabel(base) + '…');
  let got;
  try { got = await pipedStreams(base, att.item.videoId); }
  catch (e) { att.lastError = e; return tryNextYouTubeInstance(token); }
  if (!ytAttempt || ytAttempt !== att || token !== playToken || S.current !== att.item) return;
  markPipedActive(base);
  att.stream = got.stream;
  att.item.streamUrl = got.stream.url;
  att.item.streamMime = got.stream.mimeType || got.stream.format || '';
  att.item.streamBitrate = got.stream.bitrate || null;
  if (Number(got.data.duration) > 0) att.item.duration = Number(got.data.duration);
  const tapped = await probeCors(got.stream.url);
  if (!ytAttempt || ytAttempt !== att || token !== playToken || S.current !== att.item) return;
  att.stage = tapped ? 'tapped' : 'direct';
  await startAudioPlayback(att.item, got.stream.url, { tapped, attempt: att });
}
async function failYouTubeAttempt(reason){
  const att = ytAttempt;
  if (!att || att.advancing || S.current !== att.item) return;
  att.advancing = true;
  att.lastError = reason;
  // Kegagalan pada jalur bertap analyser: coba URL yang sama tanpa tap
  // dulu (kasus CORS) — jangan langsung mengorbankan trek/instance ini.
  if (att.stream && att.stage === 'tapped') {
    att.stage = 'direct';
    att.advancing = false;
    setStatus('Aliran menolak tap analyser (CORS) — tetap diputar tanpa tap…');
    await startAudioPlayback(att.item, att.stream.url, { tapped: false, attempt: att });
    return;
  }
  att.advancing = false;
  await tryNextYouTubeInstance(att.token);
}
function fallbackToEmbed(item){
  if (S.current !== item) return;
  pauseAllAudio();
  audio = audioMain;
  S.playMode = 'embed';
  item.embedFallback = true;
  els.ytMount.hidden = false;
  refreshPlaybackChrome();
  renderAll();
  setStatus('Semua aliran audio Piped gagal untuk trek ini — memakai embed resmi YouTube (iklan & latar mengikuti YouTube).', true);
  ytLoad(item.videoId);
}
async function playQueueAt(idx){
  if (idx < 0 || idx >= S.queue.length) return;
  const it = S.queue[idx];
  const token = ++playToken;
  ytAttempt = null;
  S.idx = idx; S.current = it;
  it.embedFallback = false;
  setPlaying(false);
  stopEmbed();

  if (it.source === 'archive') {
    S.playMode = 'audio';
    selectAudio('main');
    beginCurrent(it);
    setStatus('Menyiapkan berkas Archive…');
    await iaResolve(it);
    if (token !== playToken || S.current !== it) return;
    if (!it.playable) {
      S.playMode = null;
      setStatus('Item Archive ini tidak punya berkas audio yang bisa diputar.', true);
      return;
    }
    await startAudioPlayback(it, it.streamUrl, { tapped: true });
  } else {
    // YouTube: hentikan audio lama, lalu rantai aliran Piped. Embed
    // tidak ditampilkan sama sekali kecuali fallbackToEmbed() dipanggil.
    pauseAllAudio();
    audio = audioMain;
    S.playMode = 'resolving';
    beginCurrent(it);
    await playYouTubeAudio(it, token);
  }
}
function playList(items, idx){
  S.queue = items.slice();
  renderQueue();
  playQueueAt(idx);
}
function togglePlay(){
  if (!S.current) { if (S.queue.length) playQueueAt(0); return; }
  if (ytEmbedActive()) {
    if (!ytPlayer) return;
    if (S.playing) ytPlayer.pauseVideo(); else ytPlayer.playVideo();
  } else if (audioBacked()) {
    if (audio.paused) {
      if (S.playMode === 'audio') ensureAudioCtx();
      audio.play().catch(()=>{});
    } else audio.pause();
  }
}
function next(auto=false){
  if (!S.queue.length) return;
  if (S.repeat === 'one' && auto) { playQueueAt(S.idx); return; }
  let n;
  if (S.shuffle && S.queue.length > 1) {
    do { n = Math.floor(Math.random() * S.queue.length); } while (n === S.idx);
  } else n = S.idx + 1;
  if (n >= S.queue.length) {
    if (S.repeat === 'all' || !auto) n = 0; else { setPlaying(false); return; }
  }
  playQueueAt(n);
}
function prev(){
  if (!S.queue.length) return;
  // bila sudah >3 detik, ulangi lagu daripada mundur
  const t = ytEmbedActive() ? ytGetTime() : audio.currentTime;
  if (t > 3) { seekTo(0); return; }
  playQueueAt((S.idx - 1 + S.queue.length) % S.queue.length);
}
function onEnded(){ next(true); }
function seekTo(sec){
  if (!S.current) return;
  if (ytEmbedActive()) { try { ytPlayer.seekTo(sec, true); } catch {} }
  else if (isFinite(audio.duration)) audio.currentTime = sec;
}
function curTime(){ return ytEmbedActive() ? ytGetTime() : (audio.currentTime || 0); }
function curDur(){ return ytEmbedActive() ? ytGetDur() : (isFinite(audio.duration) ? audio.duration : (S.current?.duration || 0)); }

/* audio element events — diikat ke elemen utama maupun elemen
   direct; hanya elemen yang sedang aktif yang boleh mengubah UI. */
let failStreak = 0;
function bindAudioEvents(el){
  el.addEventListener('play',  () => { if (el === audio) setPlaying(true); });
  el.addEventListener('pause', () => { if (el === audio) setPlaying(false); });
  el.addEventListener('ended', () => { if (el === audio) { setPlaying(false); onEnded(); } });
  el.addEventListener('playing', () => { if (el === audio) { failStreak = 0; setStatus(''); } });
  el.addEventListener('error', () => {
    if (el !== audio || !S.current) return;
    if (S.current.source === 'youtube' && audioBacked() && ytAttempt) {
      void failYouTubeAttempt(el.error || new Error('aliran audio gagal dimuat'));
      return;
    }
    if (S.current.source !== 'archive') return;
    failStreak++;
    if (S.queue.length > 1 && failStreak <= S.queue.length && S.idx < S.queue.length - 1) {
      setStatus('Berkas Archive ini tidak bisa diputar (mungkin dibatasi) — lanjut ke antrean berikutnya…', true);
      setTimeout(() => playQueueAt(S.idx + 1), 350);
    } else {
      setStatus('Berkas audio gagal dimuat dari Archive (mungkin item dibatasi untuk anonim).', true);
    }
  });
}
bindAudioEvents(audioMain);
bindAudioEvents(audioDirect);

/* progress ticker */
let seeking = false;
setInterval(() => {
  if (!S.current) return;
  const d = curDur(), t = curTime();
  if (!seeking) els.seek.value = d > 0 ? Math.round(t / d * 1000) : 0;
  els.tCur.textContent = fmt(t);
  els.tDur.textContent = fmt(d || S.current.duration || 0);
  msSetPosition();
}, 400);
els.seek.addEventListener('input', () => {
  seeking = true;
  const d = curDur();
  if (d > 0) els.tCur.textContent = fmt(els.seek.value / 1000 * d);
});
els.seek.addEventListener('change', () => {
  const d = curDur();
  if (d > 0) seekTo(els.seek.value / 1000 * d);
  seeking = false;
});

/* ============================================================
   Media Session API — putar latar + kontrol lock screen /
   notifikasi HP (mekanisme standar web). Metadata + handler di
   sini berlaku untuk pemutar gabungan. Trek Archive dan trek
   YouTube yang berhasil masuk jalur aliran kini sama-sama lewat
   elemen <audio>; hanya trek YouTube yang jatuh ke fallback
   embed yang tetap tunduk pada aturan embed YouTube sendiri.
   ============================================================ */
const hasMS = 'mediaSession' in navigator;
function msSetMetadata(it){
  if (!hasMS || !it) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: it.title || 'Musik Arkasha',
      artist: it.artist || '',
      album: it.source === 'archive' ? 'Internet Archive'
        : (S.playMode === 'embed' ? 'YouTube · embed fallback' : 'YouTube · audio Piped'),
      artwork: it.thumb ? [{ src: it.thumb, sizes: '512x512', type: 'image/jpeg' }] : [],
    });
  } catch {}
}
function msSyncState(){
  if (!hasMS) return;
  try {
    navigator.mediaSession.playbackState =
      S.playing ? 'playing' : (S.current ? 'paused' : 'none');
  } catch {}
}
function msSetPosition(){
  if (!hasMS || typeof navigator.mediaSession.setPositionState !== 'function') return;
  const d = curDur(), t = curTime();
  if (!(d > 0) || !isFinite(d) || !isFinite(t)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: d,
      playbackRate: 1,
      position: Math.min(Math.max(0, t), d),
    });
  } catch {}
}
(function msSetHandlers(){
  if (!hasMS) return;
  const set = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch {} };
  set('play',  () => togglePlay());
  set('pause', () => togglePlay());
  set('previoustrack', () => prev());
  set('nexttrack', () => next(false));
  set('seekto', e => {
    if (e.seekTime == null) return;
    if (e.fastSeek && audioBacked()) { try { audio.fastSeek(e.seekTime); return; } catch {} }
    seekTo(e.seekTime);
  });
  set('seekbackward', e => seekTo(Math.max(0, curTime() - (e.seekOffset || 10))));
  set('seekforward',  e => seekTo(curTime() + (e.seekOffset || 10)));
})();

/* controls */
$('#btnPlay').addEventListener('click', togglePlay);
$('#btnNext').addEventListener('click', () => next(false));
$('#btnPrev').addEventListener('click', prev);
$('#btnShuffle').addEventListener('click', e => {
  S.shuffle = !S.shuffle;
  e.currentTarget.classList.toggle('is-on', S.shuffle);
  setStatus('Acak ' + (S.shuffle ? 'nyala' : 'mati'));
});
$('#btnRepeat').addEventListener('click', e => {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  e.currentTarget.classList.toggle('is-on', S.repeat !== 'off');
  $('#repeatTag').hidden = S.repeat !== 'one';
  e.currentTarget.title = 'Ulangi: ' + (S.repeat === 'off' ? 'mati' : S.repeat === 'all' ? 'semua' : 'satu lagu');
  setStatus('Ulangi: ' + (S.repeat === 'off' ? 'mati' : S.repeat === 'all' ? 'semua antrean' : 'satu lagu'));
});
$('#vol').addEventListener('input', e => {
  const v = e.target.value / 100;
  audioMain.volume = v;
  audioDirect.volume = v;
  try { ytPlayer && ytPlayer.setVolume && ytPlayer.setVolume(e.target.value); } catch {}
});
audioMain.volume = 0.8;
audioDirect.volume = 0.8;
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) {
    e.preventDefault(); togglePlay();
  }
});

/* ============================================================
   Visualisasi — Web Audio API untuk audio yang berhasil ditap
   (Archive + YouTube aliran CORS-lolos); reaktif semu hanya
   untuk fallback embed / aliran tanpa tap analyser.
   ============================================================ */
const canvas = $('#viz'), ctx2d = canvas.getContext('2d');
let audioCtx = null, analyser = null, freqData = null, timeData = null;
let vizMode = 'bars';
const smooth = new Float32Array(128);   // nilai halus antar-frame
function ensureAudioCtx(){
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaElementSource(audioMain);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.78;
    src.connect(analyser); analyser.connect(audioCtx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
    timeData = new Uint8Array(analyser.fftSize);
  } catch (e) { /* visualisasi nonaktif; audio tetap jalan lewat elemen */ }
}
function fitCanvas(){
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(300, Math.round(r.width * dpr));
  canvas.height = Math.max(150, Math.round(r.height * dpr));
}
new ResizeObserver(fitCanvas).observe(canvas.parentElement);
fitCanvas();

/* data semu untuk jalur tanpa tap: denyut mengikuti waktu putar */
function pseudoFreq(out, t){
  const n = out.length;
  const beat = Math.pow(Math.max(0, Math.sin(t * 2.2)), 3) * 0.55 + 0.45;
  for (let i = 0; i < n; i++) {
    const x = i / n;
    const env = Math.pow(1 - x, 1.35);
    const w1 = Math.sin(t * 1.7 + i * 0.32) * 0.5 + 0.5;
    const w2 = Math.sin(t * 3.9 - i * 0.11) * 0.5 + 0.5;
    const w3 = Math.sin(t * 0.6 + i * 0.9) * 0.5 + 0.5;
    out[i] = Math.min(255, 255 * env * beat * (0.25 + 0.45 * w1 + 0.2 * w2 + 0.1 * w3));
  }
}
function currentFreq(target){
  if (analyser && audioTapActive()) {
    analyser.getByteFrequencyData(target);
    return;
  }
  if (S.playing && (ytEmbedActive() || S.playMode === 'audio-direct')) {
    pseudoFreq(target, curTime() || performance.now() / 1000);
    return;
  }
  target.fill(0);
}
const rawFreq = new Uint8Array(256);
function drawViz(){
  requestAnimationFrame(drawViz);
  const W = canvas.width, H = canvas.height;
  if (!W) return;
  ctx2d.clearRect(0, 0, W, H);
  // latar panggung halus
  const bg = ctx2d.createRadialGradient(W/2, H*0.9, 40, W/2, H*0.9, W*0.75);
  bg.addColorStop(0, 'rgba(255,140,66,0.13)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx2d.fillStyle = bg; ctx2d.fillRect(0, 0, W, H);

  currentFreq(rawFreq);
  const BINS = 96;
  for (let i = 0; i < BINS; i++) {
    const v = rawFreq[Math.floor(i * rawFreq.length / BINS * 0.78)] / 255;
    smooth[i] += (v - smooth[i]) * (v > smooth[i] ? 0.55 : 0.16);
  }
  const grad = ctx2d.createLinearGradient(0, H, 0, 0);
  grad.addColorStop(0, '#ff5e7a'); grad.addColorStop(0.55, '#ffb454'); grad.addColorStop(1, '#ffe29a');

  if (vizMode === 'bars') {
    const bw = W / BINS;
    ctx2d.fillStyle = grad;
    for (let i = 0; i < BINS; i++) {
      const h = Math.max(2, smooth[i] * H * 0.86);
      const x = i * bw + bw * 0.18, y = H - h - H * 0.05;
      ctx2d.beginPath();
      ctx2d.roundRect(x, y, bw * 0.64, h, bw * 0.3);
      ctx2d.fill();
      // pantulan
      ctx2d.globalAlpha = 0.16;
      ctx2d.fillRect(x, H - H * 0.05 + 3, bw * 0.64, h * 0.22);
      ctx2d.globalAlpha = 1;
    }
  } else if (vizMode === 'wave') {
    let data = null;
    if (analyser && audioTapActive()) {
      analyser.getByteTimeDomainData(timeData); data = timeData;
    }
    ctx2d.lineWidth = Math.max(2, H * 0.012);
    ctx2d.strokeStyle = '#ffb454';
    ctx2d.shadowColor = 'rgba(255,140,66,.55)'; ctx2d.shadowBlur = 12;
    ctx2d.beginPath();
    const N = 220, mid = H / 2, amp = H * 0.36;
    for (let i = 0; i <= N; i++) {
      let v;
      if (data) v = (data[Math.floor(i / N * (data.length - 1))] - 128) / 128;
      else { // gelombang semu dari spektrum halus
        const s = smooth[Math.floor(i / N * BINS)] || 0;
        v = Math.sin(i * 0.32 + performance.now() / 300) * s * 0.9;
      }
      const x = i / N * W, y = mid + v * amp;
      i ? ctx2d.lineTo(x, y) : ctx2d.moveTo(x, y);
    }
    ctx2d.stroke(); ctx2d.shadowBlur = 0;
  } else { /* radial */
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.21;
    ctx2d.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath(); ctx2d.arc(cx, cy, R, 0, Math.PI * 2); ctx2d.stroke();
    ctx2d.fillStyle = grad;
    const N = 72;
    for (let i = 0; i < N; i++) {
      const a = i / N * Math.PI * 2 - Math.PI / 2;
      const v = smooth[Math.floor(i / N * BINS)];
      const len = 4 + v * Math.min(W, H) * 0.30;
      ctx2d.globalAlpha = 0.35 + v * 0.65;
      ctx2d.beginPath();
      ctx2d.lineWidth = Math.max(2, Math.min(W, H) * 0.008);
      ctx2d.strokeStyle = i % 3 ? '#ffb454' : '#ff5e7a';
      ctx2d.moveTo(cx + Math.cos(a) * (R + 3), cy + Math.sin(a) * (R + 3));
      ctx2d.lineTo(cx + Math.cos(a) * (R + 3 + len), cy + Math.sin(a) * (R + 3 + len));
      ctx2d.stroke();
    }
    ctx2d.globalAlpha = 1;
    // inti berdenyut
    const pulse = 1 + (smooth[2] || 0) * 0.18;
    ctx2d.beginPath(); ctx2d.arc(cx, cy, R * 0.52 * pulse, 0, Math.PI * 2);
    ctx2d.fillStyle = 'rgba(255,180,84,0.16)'; ctx2d.fill();
  }
}
requestAnimationFrame(drawViz);
$$('.mode-btn').forEach(b => b.addEventListener('click', () => {
  vizMode = b.dataset.mode;
  $$('.mode-btn').forEach(x => x.classList.toggle('is-active', x === b));
}));

/* ============================================================
   Interaksi daftar (delegasi), tab, filter, modal playlist
   ============================================================ */
function itemsOf(ul){ return ul._items || []; }
document.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  const li = e.target.closest('.track');
  if (btn && li) {
    e.stopPropagation();
    const ul = li.closest('ul');
    const items = itemsOf(ul);
    const it = items[+li.dataset.idx];
    if (!it) return;
    const act = btn.dataset.act;
    if (act === 'fav') {
      const k = keyOf(it);
      if (isFav(it)) S.favs = S.favs.filter(f => keyOf(f) !== k); else S.favs.push(it);
      store.set('favs', S.favs); renderAll();
    } else if (act === 'addq') {
      S.queue.push(it); renderQueue(); setStatus('Ditambahkan ke antrean: ' + it.title);
    } else if (act === 'addpl') {
      openPlModal(it);
    } else if (act === 'rmq') {
      const i = +li.dataset.idx;
      S.queue.splice(i, 1);
      if (i === S.idx) { S.idx = -1; } else if (i < S.idx) S.idx--;
      renderQueue();
    } else if (act === 'rmpl') {
      const pi = +li.dataset.ctx.split(':')[1];
      S.playlists[pi].items.splice(+li.dataset.idx, 1);
      store.set('playlists', S.playlists); renderPlaylists();
    }
    return;
  }
  if (li) {
    const ul = li.closest('ul');
    const items = itemsOf(ul);
    if (items.length) playList(items, +li.dataset.idx);
  }
});
$$('.tab').forEach(t => t.addEventListener('click', () => {
  S.tab = t.dataset.tab;
  $$('.tab').forEach(x => x.classList.toggle('is-active', x === t));
  ['results','queue','favs','playlists','history'].forEach(name => {
    $('#panel-' + name).hidden = name !== S.tab;
  });
}));
$$('.chip').forEach(c => c.addEventListener('click', () => {
  S.filter = c.dataset.filter;
  $$('.chip').forEach(x => x.classList.toggle('is-active', x === c));
  renderResults();
}));
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  doSearch($('#searchInput').value);
  if (S.tab !== 'results') $$('.tab').find(t => t.dataset.tab === 'results').click();
});
$('#btnClearHistory').addEventListener('click', () => { S.history = []; store.set('history', []); renderHistory(); });

/* playlist: buat & modal */
function addPlaylist(name){
  name = (name || '').trim();
  if (!name) return null;
  const pl = { name, items: [] };
  S.playlists.push(pl); store.set('playlists', S.playlists); renderPlaylists();
  return pl;
}
$('#btnNewPlaylist').addEventListener('click', () => {
  if (addPlaylist($('#newPlaylistName').value)) { $('#newPlaylistName').value = ''; setStatus('Playlist dibuat.'); }
});
let modalItem = null;
function openPlModal(it){
  modalItem = it;
  $('#plModalTitle').textContent = it.title;
  const list = $('#plModalList');
  list.innerHTML = S.playlists.length
    ? S.playlists.map((pl, i) => `<button data-pli="${i}">${esc(pl.name)} <span style="color:var(--dim)">(${pl.items.length})</span></button>`).join('')
    : '<div class="empty">Belum ada playlist — buat baru di bawah.</div>';
  $$('#plModalList [data-pli]').forEach(b => b.addEventListener('click', () => {
    S.playlists[+b.dataset.pli].items.push(modalItem);
    store.set('playlists', S.playlists); renderPlaylists();
    closePlModal(); setStatus('Ditambahkan ke playlist.');
  }));
  $('#plModal').hidden = false;
}
function closePlModal(){ $('#plModal').hidden = true; modalItem = null; }
$('#plModalClose').addEventListener('click', closePlModal);
$('#plModal').addEventListener('click', e => { if (e.target.id === 'plModal') closePlModal(); });
$('#plModalCreate').addEventListener('click', () => {
  const pl = addPlaylist($('#plModalNew').value);
  if (pl && modalItem) { pl.items.push(modalItem); store.set('playlists', S.playlists); renderPlaylists(); }
  $('#plModalNew').value = ''; closePlModal(); setStatus('Ditambahkan ke playlist baru.');
});
els.playlistWrap.addEventListener('click', e => {
  const b = e.target.closest('[data-plact]');
  if (!b) return;
  const pi = +b.dataset.pi;
  if (b.dataset.plact === 'play') {
    if (S.playlists[pi].items.length) playList(S.playlists[pi].items, 0);
  } else {
    if (confirm('Hapus playlist “' + S.playlists[pi].name + '”?')) {
      S.playlists.splice(pi, 1); store.set('playlists', S.playlists); renderPlaylists();
    }
  }
});

/* ============================================================
   Mode uji (?debug=1&q=...&autoplay=1&mode=radial)
   ============================================================ */
const params = new URLSearchParams(location.search);
if (params.get('mode')) {
  const b = $$('.mode-btn').find(x => x.dataset.mode === params.get('mode'));
  if (b) b.click();
}
if (params.get('debug') === '1') {
  els.debug.hidden = false;
  setInterval(() => {
    let avg = 0;
    if (freqData && analyser && audioTapActive()) {
      analyser.getByteFrequencyData(freqData);
      avg = Math.round(freqData.reduce((a, b) => a + b, 0) / freqData.length);
    }
    els.debug.textContent =
      `src=${S.current?.source || '-'} mode=${S.playMode || '-'} tap=${audioTapActive() ? 1 : 0} state=${S.playing ? 'playing' : 'paused'} ` +
      `t=${curTime().toFixed(1)}/${curDur().toFixed(1)} freqAvg=${avg} queue=${S.queue.length} ` +
      `results=${S.results.length} piped=${S.pipedBase || '-'}`;
    window.__MA_STATS = {
      src: S.current?.source, mode: S.playMode, tapped: audioTapActive(),
      playing: S.playing, t: curTime(), freqAvg: avg, results: S.results.length,
      streamMime: S.current?.streamMime || null, streamBitrate: S.current?.streamBitrate || null,
      embedFallback: !!S.current?.embedFallback,
    };
  }, 500);
}

/* ---------------- init ---------------- */
renderAll();
if (params.get('q')) {
  $('#searchInput').value = params.get('q');
  (async () => {
    await doSearch(params.get('q'));
    if (params.get('autoplay') === '1') {
      // putar trek Archive pertama yang berkasnya bisa diputar
      const arch = S.results.filter(i => i.source === 'archive');
      for (const it of arch) {
        await iaResolve(it);
        if (it.playable) {
          S.queue = S.results.slice(); renderQueue();
          playQueueAt(S.results.indexOf(it));
          break;
        }
      }
    } else if (params.get('autoplay') === 'yt') {
      const yt = S.results.find(i => i.source === 'youtube');
      if (yt) { S.queue = S.results.slice(); renderQueue(); playQueueAt(S.results.indexOf(yt)); }
    }
  })();
}
