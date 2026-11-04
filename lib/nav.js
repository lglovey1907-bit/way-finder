// Turn-by-turn navigation for passengers, in the style of a street-map app.
// Full-screen map that follows the passenger (route-up, tilted), a green instruction banner, distance / time left,
// and spoken directions in Hindi (or English): turns, stairs, lifts, escalators, gates, platforms, arrival.
// Position (indoors GPS is weak, so several signals are combined):
//  - step counting from the phone's motion sensor, moving the arrow along the route from the QR board,
//  - phone GPS, trusted only when it is accurate (±15 m; nudges at ±35 m; ignored when worse),
//  - "Reached here?" taps at stairs, turns and gates, which reset the position exactly,
//  - scanning any station QR board during the walk (on the route: fixes the position; elsewhere: new route from there).
// "Demo walk" walks the route by itself.
//
// openNav(route) — route = {
//   line: [[lat,lng],…], level: [0|1 per point] (1 = up on a foot over bridge),
//   moves: [{d, type, hi, en, hiPlace, enPlace}] (d = metres from start where it happens),
//   dest: {name}, start: {name}, total,
//   overlay: {platforms:[{line,island}], bridges:[[a,b]…], gates:[{ll,name,status}], amenities:[{ll,name,code,open,dest}], outside:[{pts,color,shape,name}], works:[{ll,r}]},
//   onClose: fn }

const R = 6371008.8, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
const norm = (d) => ((d % 360) + 360) % 360;
const angDiff = (a, b) => ((b - a + 540) % 360) - 180;
const STYLE_MAP = 'https://tiles.openfreemap.org/styles/liberty';
const STYLE_SAT = { version: 8, sources: { sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri' } }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#F3F1EC' } }, { id: 'sat', type: 'raster', source: 'sat' }] };
const STYLE_OSM = { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } }, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#F3F1EC' } }, { id: 'osm', type: 'raster', source: 'osm' }] };
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

// ---------- geometry on a local flat frame (metres) ----------
function frame(o) { const kx = R * Math.cos(rad(o[0])) * Math.PI / 180, ky = R * Math.PI / 180; return { to: (p) => [(p[1] - o[1]) * kx, (p[0] - o[0]) * ky], ll: (x, y) => [o[0] + y / ky, o[1] + x / kx] }; }
function bearingXY(a, b) { return norm(deg(Math.atan2(b[0] - a[0], b[1] - a[1]))); }

class Path {
  constructor(line) {
    this.F = frame(line[0]); this.P = line.map(this.F.to); this.cum = [0];
    for (let i = 1; i < this.P.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.P[i][0] - this.P[i - 1][0], this.P[i][1] - this.P[i - 1][1]));
    this.total = this.cum[this.cum.length - 1];
  }
  seg(d) { const c = this.cum; let i = 0; while (i < c.length - 2 && c[i + 1] <= d) i++; return i; }
  at(d) { d = Math.max(0, Math.min(this.total, d)); const i = this.seg(d), a = this.P[i], b = this.P[i + 1] || a, L = (this.cum[i + 1] || 0) - this.cum[i], t = L > 1e-6 ? (d - this.cum[i]) / L : 0; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]; }
  ll(d) { const p = this.at(d); return this.F.ll(p[0], p[1]); }
  // direction of travel at d, looking a few metres ahead so the camera turns smoothly into corners
  bearing(d) { const a = this.at(Math.max(0, d - 2)), b = this.at(Math.min(this.total, d + 7)); return Math.hypot(b[0] - a[0], b[1] - a[1]) < .3 ? null : bearingXY(a, b); }
  // nearest point on the path; prefers points close to where we were (hint) so loops and parallel platforms don't jump
  project(ll, hint) {
    const p = this.F.to(ll); let best = null;
    for (let i = 0; i < this.P.length - 1; i++) {
      const a = this.P[i], b = this.P[i + 1], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)) : 0;
      const qx = a[0] + vx * t, qy = a[1] + vy * t, off = Math.hypot(p[0] - qx, p[1] - qy), d = this.cum[i] + Math.sqrt(L2) * t;
      const score = off + (hint == null ? 0 : Math.max(0, Math.abs(d - hint) - 25) * .35);
      if (!best || score < best.score) best = { score, off, d };
    }
    return best;
  }
}

// ---------- words ----------
const ICON = {
  straight: '<path d="M12 21V5M6 11l6-6 6 6"/>',
  right: '<path d="M7 21v-8a4 4 0 0 1 4-4h8M15 5l4 4-4 4"/>',
  left: '<path d="M17 21v-8a4 4 0 0 0-4-4H5M9 5L5 9l4 4"/>',
  slightright: '<path d="M8 21v-6l8-8M10 7h6v6"/>',
  slightleft: '<path d="M16 21v-6L8 7M14 7H8v6"/>',
  uturn: '<path d="M8 21V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4"/>',
  stairsup: '<path d="M3 20h4v-4h4v-4h4V8h4V4"/><path d="M14 4h5v5"/>',
  stairsdown: '<path d="M3 4h4v4h4v4h4v4h4v4"/><path d="M19 15v5h-5"/>',
  liftup: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 16V8M9 11l3-3 3 3"/>',
  liftdown: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M12 8v8M9 13l3 3 3-3"/>',
  escup: '<path d="M3 19h4l9-11h5"/><path d="M14 5h7v7"/>',
  escdown: '<path d="M3 5h4l9 11h5"/><path d="M21 12v7h-7"/>',
  gate: '<path d="M4 21V5h16v16"/><path d="M9 21v-8h6v8"/><path d="M12 3v2"/>',
  platform: '<rect x="3" y="9" width="18" height="6" rx="1"/><path d="M3 19h18M3 5h18"/>',
  arrive: '<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  off: '<path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k] || ICON.straight}</svg>`;
const HI_DIG = (n) => String(n);
function distHi(m) { m = Math.round(m); if (m >= 1000) return `${(m / 1000).toFixed(1)} किलोमीटर`; return `${HI_DIG(m)} मीटर`; }
function distEn(m) { m = Math.round(m); return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`; }
function roundStep(m) { return m > 100 ? Math.round(m / 50) * 50 : m > 30 ? Math.round(m / 10) * 10 : Math.max(5, Math.round(m / 5) * 5); }

export function openNav(route) {
  const old = document.getElementById('navx'); if (old) old.remove();
  const lang0 = store.get('wf-nav-lang', 'hi'), voice0 = store.get('wf-nav-voice', '1') !== '0', base0 = store.get('wf-nav-base', 'map');
  const S = { lang: lang0, voice: voice0, base: base0, follow: true, d: 0, shown: 0, target: 0, sim: false, simSpeed: 1.3, gps: null, acc: null, off: 0, started: false, arrived: false, said: {}, lastOffSay: 0, bearing: null, raw: null, fixT: 0, steps: 0, stepT: 0, motion: false, heading: null, headT: 0, headSm: null, gpsGoodT: 0, ok: {}, ask: -1, scan: false, climb: null, touch: false, orient: store.get('wf-nav-orient', 'heading') };
  const path = new Path(route.line), total = path.total;
  // route-locked navigation (drawn station map): no GPS; steps and turns move the arrow along the route only; works offline
  const LOCK = !!route.motionOnly, BASE_MAP = LOCK ? STYLE_OSM : STYLE_MAP;
  S.stepLen = +store.get('wf-step-len', '0.7') || 0.7; S.lastFix = { d: 0, steps: 0 }; S.snaps = 0;
  const moves = (route.moves || []).filter((m) => m.d <= total + 1).sort((a, b) => a.d - b.d);
  const LV = route.level || [], levelAt = (d) => { const i = path.seg(d); return route.levelNames ? Math.min(LV[i] || 0, LV[i + 1] == null ? LV[i] || 0 : LV[i + 1]) : LV[i] && LV[i + 1] ? 1 : 0; };
  const onStairs = (d) => { const i = path.seg(d); return (LV[i] || 0) !== (LV[i + 1] == null ? LV[i] || 0 : LV[i + 1]); };
  // level changes: stairs, lifts, escalators. A flight between the ground and a foot over bridge is ~35 steps whatever its
  // length on the drawing (often only 1-3 m), so the arrow climbs it step by step and never jumps to the top.
  const STAIR_N = Math.max(12, Math.round((+route.levelH || 6) / 0.17));
  const LINKS = []; for (let i = 0; i + 1 < path.cum.length; i++) { const a = LV[i] || 0, b = LV[i + 1] == null ? a : LV[i + 1]; if (a === b) continue;
    const at = path.cum[i], mv = moves.find((m) => /^(stairs|lift|esc)/.test(m.type) && Math.abs(m.d - at) < 4);
    LINKS.push({ a: at, b: path.cum[i + 1], up: b > a, kind: mv && /^lift/.test(mv.type) ? 'lift' : mv && /^esc/.test(mv.type) ? 'esc' : 'stairs', m: mv || null }); }
  const linkFrom = (d) => LINKS.find((L) => L.a >= d) || null;      // the next level change ahead
  const linkBefore = (d) => { let r = null; LINKS.forEach((L) => { if (L.b < d - 0.05) r = L; }); return r; };
  const linkAtStart = (d) => LINKS.find((L) => Math.abs(L.a - d) < 1.5) || null;
  function startClimb(L) { S.climb = { L, n: 0, t0: Date.now() }; S.target = L.a; }
  function endClimb() { const L = S.climb && S.climb.L; if (!L) return; S.climb = null; S.target = Math.max(S.target, L.b + 0.3); S.lastFix = { d: S.target, steps: S.steps }; confirmUpTo(L.b); if (navigator.vibrate) navigator.vibrate(30); }
  // checkpoints: the places a passenger can recognise (stairs, lifts, turns, gates, platform entry)
  const cps = moves.map((m, k) => ({ m, k })).filter((c) => c.m.type !== 'straight' && c.m.type !== 'arrive' && c.m.d > 8);
  const nextCp = (d) => cps.find((c) => !S.ok[c.k] && c.m.d > d - 12) || null;
  function confirmUpTo(d) { cps.forEach((c) => { if (c.m.d <= d + 3) { S.ok[c.k] = 1; S.said[c.k + ':pre'] = 1; S.said[c.k + ':now'] = 1; } }); }

  const el = document.createElement('div'); el.id = 'navx'; el.className = 'navx'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Navigation');
  el.innerHTML = `<div class="nx-map" id="nxMap"></div>
    <div class="nx-top">
      <div class="nx-banner" id="nxBanner" aria-live="polite"><div class="nx-ic" id="nxIc">${svg('straight')}</div><div class="nx-tx"><div class="nx-dist" id="nxDist"></div><div class="nx-main" id="nxMain">रास्ता तैयार है</div><div class="nx-sub" id="nxSub"></div></div><button type="button" class="nx-thumb" id="nxThumb" hidden aria-label="See a photo of this spot"><img alt=""></button></div>
      <div class="nx-then" id="nxThen" hidden></div>
      <div class="nx-level" id="nxLevel" hidden></div>
    </div>
    <div class="nx-side">
      <button type="button" class="nx-fab" id="nxVoice" aria-pressed="${S.voice}" title="Voice on/off"></button>
      <button type="button" class="nx-fab" id="nxBase" title="Map / satellite"></button>
      <button type="button" class="nx-fab nx-lang" id="nxLang" title="भाषा / Language"></button>
      <button type="button" class="nx-fab nx-compass" id="nxCompass"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l4 10h-8z" fill="#EA4335"/><path d="M12 22l-4-10h8z" fill="#9AA0A6"/></svg><span></span></button>
    </div>
    <div class="nx-toast" id="nxToast" hidden></div>
    <div hidden>
    </div>
    <button type="button" class="nx-recenter" id="nxRecenter" hidden>${svg('straight')}<span>Re-centre · वापस</span></button>
    <div class="nx-sheet" id="nxSheet">
      <div class="nx-grab" aria-hidden="true"></div>
      <div class="nx-ck" id="nxCk" hidden><div class="nx-ck-q"><span class="nx-ck-ic" id="nxCkIc"></span><div><b id="nxCkHi"></b><span id="nxCkEn"></span></div></div>
      <button type="button" class="nx-ck-ph" id="nxCkPh" hidden aria-label="Enlarge photo"></button>
      <div class="nx-ck-b"><button type="button" class="nx-ck-yes" id="nxCkYes">✓ हाँ, यहाँ हूँ · I'm here</button><button type="button" class="nx-ck-scan" id="nxCkScan" title="Scan a station QR board">📷</button></div></div>
      <div class="nx-row">
        <button type="button" class="nx-x" id="nxClose" aria-label="Close navigation">✕</button>
        <div class="nx-eta"><b id="nxMin"></b><span id="nxMeta"></span></div>
        <button type="button" class="nx-ov" id="nxOverview" title="See the whole route">⤢</button>
      </div>
      <div class="nx-start" id="nxStartRow">
        <button type="button" class="nx-go" id="nxGo"><span>▶</span> शुरू करें · Start</button>
        <button type="button" class="nx-demo" id="nxDemo">Demo walk · डेमो</button>
      </div>
      <div class="nx-run" id="nxRunRow" hidden>
        <span class="nx-src" id="nxSrc"></span>
        <button type="button" class="nx-demo" id="nxScan">📷 Scan board</button>
        <button type="button" class="nx-demo" id="nxSpeed" hidden>1×</button>
        <button type="button" class="nx-stop" id="nxStop">Stop · रोकें</button>
      </div>
      <p class="nx-note" id="nxNote">The arrow moves with your steps, and with GPS where it is accurate. Tap ✓ at each stairs or turn, or scan any yellow QR board, to correct it. · तीर आपके कदमों से चलता है। हर सीढ़ी/मोड़ पर ✓ दबाएँ या कोई भी QR बोर्ड स्कैन करें।</p>
    </div>
    <div class="nx-arrive" id="nxArrive" hidden><div class="nx-arr-card">${svg('arrive')}<h3>पहुँच गए · You have arrived</h3><p id="nxArrName"></p><button type="button" class="nx-go" id="nxDone">ठीक है · Done</button></div></div>
    <div class="nx-lb" id="nxLb" hidden><div class="nx-lb-in" id="nxLbIn"></div><p id="nxLbT"></p><button type="button" class="nx-stop" id="nxLbX">✕ Close · बंद करें</button></div>
    <div class="nx-cam" id="nxCam" hidden><video id="nxVid" playsinline muted></video><div class="nx-cam-box" aria-hidden="true"></div>
      <p id="nxCamMsg">पास के पीले QR बोर्ड को स्कैन करें · Point at any station QR board</p><button type="button" class="nx-stop" id="nxCamX">✕ Close</button></div>
    <div class="nx-load" id="nxLoad">Loading map…</div>`;
  document.body.appendChild(el); document.body.classList.add('navx-on');
  const $ = (id) => el.querySelector('#' + id);

  // ---------- speech ----------
  const synth = window.speechSynthesis;
  let voices = []; const loadVoices = () => { try { voices = synth ? synth.getVoices() : []; } catch { voices = []; } };
  loadVoices(); if (synth && 'onvoiceschanged' in synth) synth.onvoiceschanged = loadVoices;
  function pickVoice(l) { const want = l === 'hi' ? /^hi/i : /^en[-_]IN/i; return voices.find((v) => want.test(v.lang)) || (l === 'en' ? voices.find((v) => /^en/i.test(v.lang)) : null); }
  function say(hi, en, urgent) {
    if (!S.voice || !synth) return; const l = S.lang, text = l === 'hi' ? hi : en; if (!text) return;
    try { if (urgent) synth.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = l === 'hi' ? 'hi-IN' : 'en-IN'; const v = pickVoice(l); if (v) u.voice = v; u.rate = l === 'hi' ? .95 : 1; synth.speak(u); } catch { /* no speech */ }
  }
  const updVoiceBtn = () => { $('nxVoice').innerHTML = S.voice ? '🔊' : '🔇'; $('nxVoice').setAttribute('aria-pressed', String(S.voice)); };
  const updLangBtn = () => { $('nxLang').textContent = S.lang === 'hi' ? 'हिं' : 'EN'; };
  const updBaseBtn = () => { $('nxBase').innerHTML = S.base === 'sat' ? '🗺' : '🛰'; $('nxBase').title = S.base === 'sat' ? 'Map view' : 'Satellite view'; };
  updVoiceBtn(); updLangBtn(); updBaseBtn();

  // ---------- instructions ----------
  function moveText(m, dist) {
    const near = dist != null && dist > 12;
    const hi = near ? `${distHi(roundStep(dist))} बाद, ${m.hi}` : m.hiNow || m.hi;
    const en = near ? `In ${distEn(roundStep(dist))}, ${m.en.charAt(0).toLowerCase() + m.en.slice(1)}` : m.enNow || m.en;
    return { hi, en };
  }
  function nextMove(d) { for (const m of moves) if (m.d > d + 1.5) return m; return null; }
  function afterMove(m) { const i = moves.indexOf(m); return i >= 0 ? moves[i + 1] || null : null; }

  // ---------- landmark photos (taken by staff in Photos; the arrow marks where to go) ----------
  const phHtml = (ph) => ph ? `<span class="nx-phw"><img src="${ph.url}" alt="">${ph.hs ? `<b class="nx-hs" style="left:${ph.hs.x}%;top:${ph.hs.y}%"><i></i>${S.lang === 'hi' ? 'यहाँ जाएँ' : 'Go here'}</b>` : ''}</span>` : '';
  let thumbFor = null;
  function setThumb(m) {
    const b = $('nxThumb'), ph = m && m.ph; thumbFor = ph ? m : null;
    if (!ph) { b.hidden = true; return; } const img = b.querySelector('img'); if (img.getAttribute('src') !== ph.url) img.src = ph.url; b.hidden = false;
  }
  function openPhoto(m) {
    if (!m || !m.ph) return; const all = [m.ph, ...(m.ph.more || [])];
    const show = (i) => { $('nxLbIn').innerHTML = phHtml(all[i]) + (all.length > 1 ? `<div class="nx-lbth">${all.map((p, k) => `<button type="button" data-lbi="${k}" aria-pressed="${k === i}"><img src="${p.url}" alt="${p.cap || ''}"></button>`).join('')}</div><small class="nx-lbc">${i + 1} / ${all.length}${all[i].cap ? ' · ' + all[i].cap : ''}</small>` : ''); };
    $('nxLbIn').onclick = (e) => { const b = e.target.closest('[data-lbi]'); if (b) show(+b.dataset.lbi); }; show(0);
    $('nxLbT').textContent = S.lang === 'hi' ? (m.hiNow || m.hi) : (m.enNow || m.en); $('nxLb').hidden = false;
  }
  function render() {
    const d = S.shown, left = Math.max(0, total - d), min = Math.max(1, Math.round(left / 1.2 / 60));
    $('nxMin').textContent = S.lang === 'hi' ? `${min} मिनट` : `${min} min`;
    const t = new Date(Date.now() + left / 1.2 * 1000);
    $('nxMeta').textContent = `${distEn(left)} · ${S.lang === 'hi' ? 'पहुँचेंगे' : 'arrive'} ${t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    const lv = levelAt(d); const lvEl = $('nxLevel'); lvEl.hidden = !S.started;
    if (S.climb) { const L = S.climb.L, hi = S.lang === 'hi', pc = L.kind === 'stairs' ? ` · ${Math.min(S.climb.n, STAIR_N)}/${STAIR_N}` : ''; lvEl.textContent = (L.up ? '⇡ ' : '⇣ ') + (L.kind === 'lift' ? (hi ? 'लिफ्ट में' : 'In the lift') : L.kind === 'esc' ? (hi ? 'एस्केलेटर पर' : 'On the escalator') : hi ? (L.up ? 'सीढ़ियाँ चढ़ रहे हैं' : 'सीढ़ियाँ उतर रहे हैं') : (L.up ? 'Climbing the stairs' : 'Going down the stairs')) + pc; lvEl.classList.add('up'); renderCk(); }
    else { const LN = route.levelNames && route.levelNames[lv]; if (LN) { lvEl.textContent = (lv ? '⇡ ' : '▤ ') + (S.lang === 'hi' ? LN.hi : LN.en); lvEl.classList.toggle('up', lv > 0); } else lvEl.textContent = lv ? (S.lang === 'hi' ? '⇡ ऊपर · फुट ओवर ब्रिज पर' : '⇡ Upstairs · on the foot over bridge') : (S.lang === 'hi' ? '▤ नीचे · ज़मीन स्तर' : '▤ Ground level'); lvEl.classList.toggle('up', !!lv); }
    renderCk();
    if (S.arrived) return;
    if (S.started && S.off > Math.max(30, (S.acc || 0) * 1.1)) {
      $('nxIc').innerHTML = svg('off'); $('nxBanner').classList.add('warn'); $('nxDist').textContent = distEn(S.off);
      setThumb(null); $('nxMain').textContent = S.lang === 'hi' ? 'आप रास्ते से हट गए हैं' : 'You are off the route'; $('nxSub').textContent = S.lang === 'hi' ? 'नीली लाइन की ओर वापस चलें' : 'Walk back to the blue line'; $('nxThen').hidden = true; return;
    }
    $('nxBanner').classList.remove('warn');
    if (S.climb) { const L = S.climb.L, cm = L.m || { type: L.up ? 'stairsup' : 'stairsdown', hi: L.up ? 'सीढ़ियाँ चढ़ें' : 'सीढ़ियाँ उतरें', en: L.up ? 'Climb the stairs' : 'Go down the stairs' }, hi = S.lang === 'hi';
      setThumb(cm); $('nxIc').innerHTML = svg(cm.type);
      $('nxDist').textContent = L.kind === 'stairs' ? (hi ? `लगभग ${Math.max(0, STAIR_N - S.climb.n)} सीढ़ियाँ बाकी` : `About ${Math.max(0, STAIR_N - S.climb.n)} steps to go`) : (hi ? 'ऊपर/नीचे पहुँचकर आगे चलें' : 'Walk on when you get off');
      $('nxMain').textContent = hi ? cm.hi : cm.en; $('nxSub').textContent = hi ? cm.en : cm.hi;
      const a = afterMove(cm); const th = $('nxThen'); if (a && a.type !== 'arrive') { th.hidden = false; th.innerHTML = `<span>${hi ? 'फिर' : 'Then'}</span>${svg(a.type)}`; } else th.hidden = true; return; }
    const m = nextMove(d);
    setThumb(m || moves[moves.length - 1]);
    if (!m) { $('nxIc').innerHTML = svg('arrive'); $('nxDist').textContent = distEn(left); $('nxMain').textContent = route.dest.name; $('nxSub').textContent = ''; $('nxThen').hidden = true; return; }
    const dist = m.d - d;
    $('nxIc').innerHTML = svg(m.type); $('nxDist').textContent = distEn(roundStep(dist));
    $('nxMain').textContent = S.lang === 'hi' ? m.hi : m.en; $('nxSub').textContent = S.lang === 'hi' ? m.en : m.hi;
    const a = afterMove(m); const th = $('nxThen');
    if (a && a.d - m.d < 40) { th.hidden = false; th.innerHTML = `<span>${S.lang === 'hi' ? 'फिर' : 'Then'}</span>${svg(a.type)}`; } else th.hidden = true;
  }
  function renderCk() {
    const box = $('nxCk');
    if (S.climb && S.started && !S.sim && !S.arrived) { const L = S.climb.L; if (S.ask !== 'top') { S.ask = 'top'; box.hidden = false; $('nxCkIc').innerHTML = svg(L.kind === 'lift' ? (L.up ? 'liftup' : 'liftdown') : L.kind === 'esc' ? (L.up ? 'escup' : 'escdown') : (L.up ? 'stairsup' : 'stairsdown'));
        $('nxCkHi').textContent = L.up ? 'ऊपर पहुँच गए? ✓ दबाएँ' : 'नीचे पहुँच गए? ✓ दबाएँ'; $('nxCkEn').textContent = L.up ? 'At the top? Tap ✓' : 'At the bottom? Tap ✓'; $('nxCkPh').hidden = true; } return; }
    if (S.ask === 'top') S.ask = -1;
    const c = S.started && !S.sim && !S.arrived ? nextCp(S.target) : null;
    const show = c && c.m.d - S.target < 15;
    if (!show) { if (!box.hidden) box.hidden = true; S.ask = -1; return; }
    if (S.ask !== c.k) {
      S.ask = c.k; box.hidden = false; $('nxCkIc').innerHTML = svg(c.m.type);
      $('nxCkHi').textContent = `पहुँच गए? ${c.m.hiNow || c.m.hi}`; $('nxCkEn').textContent = `Reached here? ${c.m.enNow || c.m.en}`;
      const pe = $('nxCkPh'); pe.innerHTML = phHtml(c.m.ph); pe.hidden = !c.m.ph; pe.onclick = () => openPhoto(c.m);
    }
  }
  // spoken prompts: once ~35 m before, once on the spot
  function speakFor(d) {
    if (!S.started || S.arrived) return;
    if (S.off > Math.max(30, (S.acc || 0) * 1.1)) { if (Date.now() - S.lastOffSay > 20000) { S.lastOffSay = Date.now(); say('आप रास्ते से हट गए हैं। नीली लाइन की ओर वापस चलें।', 'You are off the route. Walk back to the blue line.'); } return; }
    const m = nextMove(d); if (!m) return; const dist = m.d - d, k = moves.indexOf(m);
    if (dist <= 9 && m.type !== 'arrive') { if (!S.said[k + ':now']) { S.said[k + ':now'] = S.said[k + ':pre'] = 1; const t = moveText(m, null), m2 = afterMove(m), far = m2 && m2.d - m.d > 120 ? roundStep(m2.d - m.d) : 0; say(t.hi + (far ? `, फिर ${distHi(far)} सीधे चलें` : ''), t.en + (far ? `, then continue for ${distEn(far)}` : ''), true); } }
    else if (dist <= 40 && m.type !== 'straight') { if (!S.said[k + ':pre']) { S.said[k + ':pre'] = 1; const t = moveText(m, dist); say(t.hi, t.en); } }
  }
  function checkArrive(d) {
    if (S.arrived || total - d > 6) return;
    S.arrived = true; stopSources(); render();
    $('nxArrName').textContent = route.dest.name + (route.dest.nameHi ? ' · ' + route.dest.nameHi : ''); $('nxArrive').hidden = false;
    say(`आप अपनी मंज़िल पर पहुँच गए हैं। ${route.dest.nameHi || route.dest.name}`, `You have arrived at ${route.dest.name}.`, true);
  }

  // ---------- map ----------
  let map = null, ml = null, me = null, destM = null; const htmlMarkers = [];
  const routeGeo = (from, to) => { const pts = [path.ll(from)]; for (let i = 0; i < path.cum.length; i++) if (path.cum[i] > from && path.cum[i] < to) pts.push(route.line[i]); pts.push(path.ll(to)); return { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map((p) => [p[1], p[0]]) }, properties: {} }; };
  const meters = (m) => ['interpolate', ['exponential', 2], ['zoom'], 15, m * 0.24, 22, m * 30.5];
  // the background map is only for orientation: wash it out so the surveyed station stands out
  function fadeBase() {
    if (!map) return; const set = (id, k, v) => { try { map.setPaintProperty(id, k, v); } catch { /* not for this layer */ } };
    (map.getStyle().layers || []).forEach((L) => {
      if (L.id.startsWith('nx-')) return;
      if (L.type === 'background') set(L.id, 'background-color', '#F3F1EC');
      else if (L.type === 'raster') set(L.id, 'raster-opacity', .5);
      else if (L.type === 'fill') set(L.id, 'fill-opacity', .22);
      else if (L.type === 'fill-extrusion') set(L.id, 'fill-extrusion-opacity', .12);
      else if (L.type === 'line') set(L.id, 'line-opacity', .3);
      else if (L.type === 'symbol') { set(L.id, 'text-opacity', .4); set(L.id, 'icon-opacity', .3); }
      else if (L.type === 'circle') set(L.id, 'circle-opacity', .3);
    });
  }
  function overlays() {
    if (!map) return; fadeBase(); const o = route.overlay || {}, fc = (f) => ({ type: 'FeatureCollection', features: f });
    const add = (id, data, layers) => { if (map.getSource(id)) map.getSource(id).setData(data); else map.addSource(id, { type: 'geojson', data }); layers.forEach((L) => { if (!map.getLayer(L.id)) map.addLayer(L); }); };
    // outside the station: a grey wash with the station cut out, so the building stands out
    const ring = (poly) => [...poly, poly[0]].map((p) => [p[1], p[0]]), B = o.boundary || [];
    if (B.length) { const c = B[0][0], d = .03; add('nx-mask', fc([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[c[1] - d, c[0] - d], [c[1] + d, c[0] - d], [c[1] + d, c[0] + d], [c[1] - d, c[0] + d], [c[1] - d, c[0] - d]], ...B.map((poly) => ring(poly).reverse())] } }]),
      [{ id: 'nx-mask-f', type: 'fill', source: 'nx-mask', paint: { 'fill-color': '#5F6368', 'fill-opacity': .16 } }]); }
    add('nx-bnd', fc(B.map((poly) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(poly)] } }))),
      [{ id: 'nx-bnd-f', type: 'fill', source: 'nx-bnd', paint: { 'fill-color': '#FFFFFF', 'fill-opacity': .4 } },
       { id: 'nx-bnd-l', type: 'line', source: 'nx-bnd', layout: { 'line-join': 'round' }, paint: { 'line-color': o.boundaryColor || '#111111', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 20, 6] } }]);
    // station building layout: white, with a thin grey edge so the white line shows on any background
    add('nx-bld', fc((o.buildings || []).map((poly) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring(poly)] } }))),
      [{ id: 'nx-bld-f', type: 'fill', source: 'nx-bld', paint: { 'fill-color': '#FFFFFF', 'fill-opacity': .85 } },
       { id: 'nx-bld-c', type: 'line', source: 'nx-bld', layout: { 'line-join': 'round' }, paint: { 'line-color': '#80868B', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 20, 10] } },
       { id: 'nx-bld-l', type: 'line', source: 'nx-bld', layout: { 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.2, 20, 6.5] } }]);
    add('nx-out', fc((o.outside || []).filter((q) => q.kind !== 'station' && q.kind !== 'stationbldg' && q.shape === 'area' && q.pts.length >= 3).map((q) => ({ type: 'Feature', properties: { c: q.color || '#8E9AA6' }, geometry: { type: 'Polygon', coordinates: [[...q.pts, q.pts[0]].map((p) => [p[1], p[0]])] } }))),
      [{ id: 'nx-out-f', type: 'fill', source: 'nx-out', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': .28 } }, { id: 'nx-out-l', type: 'line', source: 'nx-out', paint: { 'line-color': ['get', 'c'], 'line-width': 1.5 } }]);
    // spaces of the drawn station map (floors above the ground a little stronger)
    add('nx-sp', fc((o.spaces || []).map((q) => ({ type: 'Feature', properties: { c: q.color, up: q.lv > 0 ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [[...q.pts, q.pts[0]].map((p) => [p[1], p[0]])] } }))),
      [{ id: 'nx-sp-f', type: 'fill', source: 'nx-sp', paint: { 'fill-color': ['get', 'c'], 'fill-opacity': ['case', ['==', ['get', 'up'], 1], 0.85, 0.75] } }, { id: 'nx-sp-l', type: 'line', source: 'nx-sp', paint: { 'line-color': '#7A8594', 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.5, 20, 1.6] } }]);
    add('nx-plat', fc((o.platforms || []).map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.line.map((q) => [q[1], q[0]]) } }))),
      [{ id: 'nx-plat-c', type: 'line', source: 'nx-plat', layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#5D5340', 'line-width': meters(11) } },
       { id: 'nx-plat-f', type: 'line', source: 'nx-plat', layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#F2E3B3', 'line-width': meters(9.4) } },
       { id: 'nx-plat-e', type: 'line', source: 'nx-plat', layout: { 'line-cap': 'butt' }, paint: { 'line-color': '#F9AB00', 'line-width': ['interpolate', ['linear'], ['zoom'], 16, .5, 20, 2.5], 'line-dasharray': [2, 2], 'line-offset': meters(4.2) } }]);
    add('nx-fob', fc((o.bridges || []).map((s) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [s[0], s[1]].map((q) => [q[1], q[0]]) } }))),
      [{ id: 'nx-fob-c', type: 'line', source: 'nx-fob', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#263238', 'line-width': meters(7.2) } },
       { id: 'nx-fob-f', type: 'line', source: 'nx-fob', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9FB3C8', 'line-width': meters(5.8) } }]);
    add('nx-walk', fc((o.walks || []).map((w) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: w.map((p) => [p[1], p[0]]) } }))),
      [{ id: 'nx-walk-l', type: 'line', source: 'nx-walk', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#9AA0A6', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 1, 20, 3], 'line-dasharray': [1.5, 1.5], 'line-opacity': .9 } }]);
    add('nx-route-all', routeGeo(0, total), [{ id: 'nx-r-case', type: 'line', source: 'nx-route-all', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0B57D0', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 20, 17] } }]);
    add('nx-done', routeGeo(0, Math.max(0.01, S.shown)), [{ id: 'nx-done-l', type: 'line', source: 'nx-done', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#A8ADB3', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 20, 13] } }]);
    add('nx-todo', routeGeo(S.shown, total), [{ id: 'nx-todo-c', type: 'line', source: 'nx-todo', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1A73E8', 'line-opacity': .18, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 20, 22] } }, { id: 'nx-todo-l', type: 'line', source: 'nx-todo', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1A73E8', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 4, 20, 11], 'line-dasharray': [0, 1.9] } }]);
  }
  function addHtmlMarkers() {
    const o = route.overlay || {};
    (o.gates || []).forEach((g) => { const e = document.createElement('div'); e.className = 'nx-gate' + (g.status === 'closed' ? ' closed' : ''); e.textContent = g.name; htmlMarkers.push(new ml.Marker({ element: e, anchor: 'bottom' }).setLngLat([g.ll[1], g.ll[0]]).addTo(map)); });
    (o.amenities || []).filter((a) => !a.dest).forEach((a) => { const e = document.createElement('div'); e.className = 'nx-am' + (a.near ? ' near' : '') + (a.open ? '' : ' shut'); e.innerHTML = `<b style="background:${a.open ? a.color || '#3C4043' : '#9AA0A6'}">${a.code || '•'}</b><span>${a.name}</span>`; htmlMarkers.push(new ml.Marker({ element: e, anchor: 'left', offset: [-11, 0] }).setLngLat([a.ll[1], a.ll[0]]).addTo(map)); });
    // platform numbers at both ends and the middle, bridge names at their middle
    (o.platforms || []).forEach((p) => { if (!p.name || !p.line || p.line.length < 2) return; const pp = new Path(p.line); [.06, .5, .94].forEach((f) => { const ll = pp.ll(pp.total * f), e = document.createElement('div'); e.className = 'nx-pf' + (f === .5 ? ' mid' : ''); e.textContent = p.name; htmlMarkers.push(new ml.Marker({ element: e }).setLngLat([ll[1], ll[0]]).addTo(map)); }); });
    (o.labels || []).forEach((b) => { const e = document.createElement('div'); e.className = 'nx-pf mid'; e.textContent = b.name; htmlMarkers.push(new ml.Marker({ element: e }).setLngLat([b.ll[1], b.ll[0]]).addTo(map)); });
    (o.bridgeNames || []).forEach((b) => { const e = document.createElement('div'); e.className = 'nx-fobl'; e.textContent = b.name; htmlMarkers.push(new ml.Marker({ element: e }).setLngLat([b.ll[1], b.ll[0]]).addTo(map)); });
    const de = document.createElement('div'); de.className = 'nx-dest'; de.innerHTML = `${svg('arrive')}<span>${route.dest.name}</span>`; const e = route.line[route.line.length - 1];
    destM = new ml.Marker({ element: de, anchor: 'bottom' }).setLngLat([e[1], e[0]]).addTo(map);
    const pe = document.createElement('div'); pe.className = 'nx-me'; pe.innerHTML = '<i class="acc"></i><i class="beam"></i><b class="dot"><svg viewBox="0 0 24 24"><path d="M12 6l5 11-5-3-5 3z"/></svg></b>';
    me = new ml.Marker({ element: pe, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([route.line[0][1], route.line[0][0]]).addTo(map);
  }
  function setBase(b) { S.base = b; store.set('wf-nav-base', b); updBaseBtn(); if (map) map.setStyle(b === 'sat' ? STYLE_SAT : BASE_MAP); }

  import('maplibre-gl').then((mod) => {
    ml = mod.default || mod; $('nxLoad').hidden = true;
    const s = route.line[0];
    map = new ml.Map({ container: $('nxMap'), style: S.base === 'sat' ? STYLE_SAT : BASE_MAP, center: [s[1], s[0]], zoom: 17.5, pitch: 0, bearing: 0, maxZoom: 21.5, attributionControl: { compact: true }, dragRotate: true, pitchWithRotate: true });
    let styleOk = false; map.on('style.load', () => { styleOk = true; overlays(); });
    map.on('error', (e) => { if (!styleOk && !LOCK && S.base === 'map' && e && e.error && /style|fetch|Failed/i.test(String(e.error.message || e.error))) { styleOk = true; map.setStyle(STYLE_OSM); } });
    setTimeout(() => { if (!styleOk && !LOCK && S.base === 'map') { styleOk = true; map.setStyle(STYLE_OSM); } }, 7000);
    addHtmlMarkers();
    const stopFollow = () => { if (S.started && S.follow) { S.follow = false; $('nxRecenter').hidden = false; } };
    map.on('dragstart', stopFollow); map.on('rotatestart', (e) => { if (e.originalEvent) stopFollow(); });
    const mc = $('nxMap'); mc.addEventListener('touchstart', () => { S.touch = true; }, { passive: true }); const tEnd = (e) => { if (!e.touches || !e.touches.length) S.touch = false; }; mc.addEventListener('touchend', tEnd, { passive: true }); mc.addEventListener('touchcancel', tEnd, { passive: true });
    mc.addEventListener('wheel', () => { S.touch = true; clearTimeout(S.wheelT); S.wheelT = setTimeout(() => { S.touch = false; }, 250); }, { passive: true });
    map.on('rotate', () => { const n = $('nxCompass') && $('nxCompass').querySelector('svg'); if (n) n.style.transform = `rotate(${-map.getBearing()}deg)`; });
    const far = () => { const z = map.getZoom(); el.classList.toggle('nx-far', z < 17.6); el.classList.toggle('nx-mid', z < 18.7); }; map.on('zoom', far); far();
    overview(true);
  }).catch(() => { $('nxLoad').textContent = "The map couldn't load. Check the internet connection."; });

  function overview(instant) {
    if (!map) return; let b = null; route.line.forEach((p) => { b = b ? b.extend([p[1], p[0]]) : new ml.LngLatBounds([p[1], p[0]], [p[1], p[0]]); });
    if (b) map.fitBounds(b, { padding: { top: 170, bottom: 230, left: 50, right: 70 }, maxZoom: 19, pitch: 0, bearing: 0, duration: instant ? 0 : 900 });
  }

  // ---------- position sources ----------
  let watch = null, simT = null, raf = 0;
  function stopSources() { if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; } if (simT) { clearInterval(simT); simT = null; } S.sim = false; stopSensors(); }
  function onFix(lat, lng, acc) {
    S.raw = [lat, lng]; S.acc = acc; S.fixT = Date.now();
    const pj = path.project([lat, lng], S.started && S.target > 0 ? S.target : null);
    const good = acc <= 15, fair = acc <= 35;
    // only accurate GPS may say "off the route"; under roofs a 40 m error would otherwise send people the wrong way
    S.off = good ? pj.off : 0;
    if (good && pj.off <= 30) {
      // never slide backwards by GPS jitter; real walking back of more than 10 m is allowed
      if (pj.d > S.target || S.target - pj.d > 10) S.target = pj.d;
      S.gpsGoodT = Date.now(); if (S.started) confirmUpTo(S.target - 10);
    } else if (fair && pj.off <= acc) {
      // rough GPS: only pull the arrow when it clearly disagrees with the steps, and only part of the way
      const gap = pj.d - S.target; if (Math.abs(gap) > acc) S.target = Math.max(0, Math.min(capD(), S.target + gap * .3));
    }
    srcText(); if (!S.started) return; checkArrive(S.target);
  }
  function startGps() {
    if (!navigator.geolocation) { $('nxSrc').textContent = 'No GPS on this phone · Demo walk is available'; return; }
    $('nxSrc').textContent = S.lang === 'hi' ? 'GPS खोज रहे हैं…' : 'Finding GPS…';
    watch = navigator.geolocation.watchPosition((p) => { const c = p.coords; onFix(c.latitude, c.longitude, c.accuracy); },
      (err) => { S.gpsErr = err.code === 1 ? 'denied' : 'none'; srcText(); },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
  }
  function startSim() {
    S.sim = true; S.off = 0; S.acc = 3; $('nxScan').hidden = true; $('nxSrc').textContent = S.lang === 'hi' ? 'डेमो वॉक' : 'Demo walk'; $('nxSpeed').hidden = false;
    simT = setInterval(() => { S.target = Math.min(total, S.target + S.simSpeed * .25); checkArrive(S.target); }, 250);
  }
  // ---------- steps (motion sensor) and compass ----------
  // the arrow may run ahead of the next un-ticked checkpoint by only a little, so step-count drift can't carry it far
  function capD() { const c = nextCp(S.target); return c && Date.now() - S.gpsGoodT > 8000 ? Math.min(total, c.m.d + 10) : total; }
  function srcText() {
    if (S.sim) return; const parts = [];
    if (LOCK) { const hi = S.lang === 'hi'; parts.push(S.motion ? `👣 ${S.steps}` : (hi ? '✓ दबाकर आगे बढ़ें' : 'tap ✓ at each point')); parts.push(hi ? 'रास्ते पर लॉक · GPS की ज़रूरत नहीं' : 'Locked to your route · no GPS needed'); if (S.snaps) parts.push(hi ? `${S.snaps} मोड़ पहचाने` : `${S.snaps} turn${S.snaps === 1 ? '' : 's'} matched`); $('nxSrc').textContent = parts.join(' · '); return; }
    if (S.motion) parts.push(`👣 ${S.steps}`);
    if (S.gpsErr === 'denied') parts.push(S.lang === 'hi' ? 'लोकेशन बंद' : 'Location off');
    else if (S.acc != null && Date.now() - S.fixT < 15000) parts.push(S.acc <= 15 ? `GPS ±${Math.round(S.acc)} m` : (S.lang === 'hi' ? `GPS कमज़ोर ±${Math.round(S.acc)} m` : `GPS weak ±${Math.round(S.acc)} m`));
    else parts.push(S.lang === 'hi' ? 'GPS नहीं' : 'No GPS');
    if (!S.motion) parts.push(S.lang === 'hi' ? '✓ दबाकर आगे बढ़ें' : 'tap ✓ at each point');
    $('nxSrc').textContent = parts.join(' · ');
  }
  // an exact position (turn matched, ✓ tapped, QR scanned): learn this passenger's step length from the walk since the last one
  function fixAt(d) {
    const walked = d - S.lastFix.d, n = S.steps - S.lastFix.steps;
    if (n >= 10 && walked > 6 && walked / n > 0.35 && walked / n < 1.1) { S.stepLen = Math.max(0.45, Math.min(0.95, S.stepLen * 0.6 + (walked / n) * 0.4)); store.set('wf-step-len', S.stepLen.toFixed(3)); }
    S.lastFix = { d, steps: S.steps };
  }
  // turns: the phone's spin about the vertical, however it is held; a turn of 50° or more while walking
  // is matched to the nearest turn of the route just ahead or behind, and the arrow jumps there exactly
  const TD = { on: false, acc: 0, quiet: 0, start: 0, t: 0 };
  function onTurnRate(e, now) {
    const r = e.rotationRate, a = e.accelerationIncludingGravity; if (!r || r.alpha == null || !a || a.x == null) return;
    const gl = Math.hypot(a.x, a.y, a.z) || 1, yaw = ((r.beta || 0) * a.x + (r.gamma || 0) * a.y + (r.alpha || 0) * a.z) / gl;
    const dt = TD.t ? Math.min(0.1, (now - TD.t) / 1000) : 0.016; TD.t = now;
    if (Math.abs(yaw) > 15) { if (!TD.on) { TD.on = true; TD.acc = 0; TD.start = now; } TD.acc += yaw * dt; TD.quiet = now; if (now - TD.start > 7000) TD.on = false; }
    else if (TD.on && now - TD.quiet > 700) { TD.on = false; const ang = Math.abs(TD.acc); if (ang >= 50 && now - TD.start < 6000) onTurn(ang); }
  }
  function onTurn(ang) {
    if (!S.started || S.sim || S.arrived || S.scan || S.climb || Date.now() - S.stepT > 4000) return;
    const nL = linkFrom(S.target), pL = linkBefore(S.target), hiD = nL ? nL.a - 0.5 : Infinity, loD = pL ? pL.b + 0.5 : -Infinity;
    const ok0 = (m) => (ang >= 130 ? /uturn|left|right/.test(m.type) : /^(left|right|slightleft|slightright)$/.test(m.type)), ok = (m) => ok0(m) && m.d < hiD && m.d > loD;
    let best = null; moves.forEach((m) => { if (!ok(m)) return; const d = m.d - S.target; if (d < -15 || d > 35) return; if (!best || Math.abs(d) < Math.abs(best.m.d - S.target)) best = { m }; });
    if (!best) return;
    fixAt(best.m.d); S.target = Math.min(total, best.m.d + 1); confirmUpTo(best.m.d); S.snaps++; if (navigator.vibrate) navigator.vibrate(30); srcText(); checkArrive(S.target);
  }
  const ST = { sm: 9.8, base: 9.8, hi: false, last: 0 };
  function onMotion(e) {
    const a = e.accelerationIncludingGravity; if (!a || a.x == null) return;
    const g = Math.hypot(a.x, a.y, a.z), now = performance.now();
    if (LOCK) onTurnRate(e, now);
    ST.sm = ST.sm * .75 + g * .25; ST.base = ST.base * .985 + g * .015; const dev = ST.sm - ST.base;
    if (!S.motion) { S.motion = true; srcText(); }
    if (!ST.hi && dev > 1.25 && now - ST.last > 290) { ST.hi = true; ST.last = now; onStep(); }
    else if (ST.hi && (dev < .4 || now - ST.last > 900)) ST.hi = false;
  }
  function onStep() {
    if (!S.started || S.sim || S.arrived || S.scan) return;
    const prevT = S.stepT; S.steps++; S.stepT = Date.now();
    if (S.climb && (S.target < S.climb.L.a - 1 || S.target > S.climb.L.b + 1)) S.climb = null;
    if (S.climb) { const C = S.climb, L = C.L;
      if (L.kind === 'stairs' || (L.kind === 'esc' && S.stepT - prevT < 1500)) { C.n++; S.target = L.a + (L.b - L.a) * Math.min(1, C.n / STAIR_N); if (C.n >= STAIR_N) endClimb(); }
      else if (S.stepT - prevT > (L.kind === 'lift' ? 6000 : 3500) && S.stepT - C.t0 > 4000) endClimb();   // stood in the lift / on the escalator, now walking off
      srcText(); checkArrive(S.target); return; }
    { const L = linkFrom(S.target - 0.05); if (L && S.target + S.stepLen >= L.a - 0.3 && S.target <= L.a + 0.05) { startClimb(L); srcText(); return; } }
    const stairs = onStairs(S.target), len = stairs ? .32 : S.stepLen;   // on stairs a step covers little ground
    const br = path.bearing(S.target); let dir = 1;
    if (!LOCK && S.heading != null && br != null && !stairs) { const df = Math.abs(angDiff(S.heading, br)); if (df > 140) dir = -1; }
    { const L = linkFrom(S.target - 0.05); S.target = Math.max(0, Math.min(capD(), L ? L.a : total, S.target + dir * len)); }
    srcText(); checkArrive(S.target);
  }
  function onOrient(e) {
    let h = null; if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
    if (h == null) return; const so = (screen.orientation && screen.orientation.angle) || 0; S.heading = norm(h + so); S.headT = Date.now(); S.headSm = S.headSm == null ? S.heading : norm(S.headSm + angDiff(S.headSm, S.heading) * 0.15); if (!raf && S.orient === 'heading' && S.follow) raf = requestAnimationFrame(loop);
  }
  let sensorsOn = false;
  function startSensors() {
    if (sensorsOn) return; sensorsOn = true;
    // iPhone asks for permission, and only inside the tap — so this runs before anything is awaited
    // (listening without permission is harmless: the phone just sends nothing until it is allowed)
    const ask = (C, go) => { try { if (C && typeof C.requestPermission === 'function') C.requestPermission().catch(() => {}); } catch { /* ignore */ } go(); };
    ask(window.DeviceMotionEvent, () => window.addEventListener('devicemotion', onMotion));
    ask(window.DeviceOrientationEvent, () => { window.addEventListener('deviceorientationabsolute', onOrient); window.addEventListener('deviceorientation', onOrient); });
  }
  function stopSensors() { sensorsOn = false; window.removeEventListener('devicemotion', onMotion); window.removeEventListener('deviceorientationabsolute', onOrient); window.removeEventListener('deviceorientation', onOrient); }
  function iAmHere() {
    if (S.climb) { const L = S.climb.L; endClimb(); say(L.up ? 'ठीक है, आप ऊपर पहुँच गए।' : 'ठीक है, आप नीचे पहुँच गए।', L.up ? 'OK, you are at the top.' : 'OK, you are at the bottom.', true); renderCk(); checkArrive(S.target); return; }
    const c = nextCp(S.target); if (!c) return;
    { const L = linkAtStart(c.m.d); if (L) { fixAt(L.a); confirmUpTo(c.m.d); startClimb(L); if (navigator.vibrate) navigator.vibrate(40); const t = moveText(c.m, null); say(`ठीक है। ${t.hi}`, `OK. ${t.en}`, true); renderCk(); return; } }
    fixAt(c.m.d); S.target = c.m.d; confirmUpTo(c.m.d); if (navigator.vibrate) navigator.vibrate(40);
    const t = moveText(c.m, null); say(`ठीक है। ${t.hi}`, `OK. ${t.en}`, true); renderCk(); checkArrive(S.target);
  }

  // ---------- scan any station QR board during the walk ----------
  let camStream = null, camT = null;
  const boardId = (text) => { try { const u = new URL(text, location.href); const h = decodeURIComponent(u.hash.slice(1)); if (h) return h.toLowerCase(); } catch { /* not a URL */ } return /^[a-z0-9][a-z0-9-]{1,40}$/i.test(text) ? text.toLowerCase() : null; };
  function camStop() { clearTimeout(camT); camT = null; if (camStream) camStream.getTracks().forEach((t) => t.stop()); camStream = null; $('nxVid').srcObject = null; $('nxCam').hidden = true; S.scan = false; }
  function onBoard(id) {
    const b = route.board ? route.board(id) : null; const msg = $('nxCamMsg');
    if (!b) { msg.textContent = 'यह स्टेशन का बोर्ड नहीं है · That is not a station board'; return false; }
    if (navigator.vibrate) navigator.vibrate(60);
    const pj = path.project(b.ll, null);
    if (pj.off <= 40) {
      camStop(); S.climb = null; fixAt(pj.d); S.target = S.shown = pj.d; S.off = 0; confirmUpTo(pj.d); S.ask = -1;
      say(`आपकी जगह अपडेट हो गई: ${b.name}`, `Position updated: ${b.name}`, true); checkArrive(S.target); return true;
    }
    // a board away from this route: start a fresh route from there to the same place
    camStop(); say(`आप ${b.name} पर हैं। नया रास्ता बना रहे हैं।`, `You are at ${b.name}. Making a new route.`, true);
    if (route.onReroute) setTimeout(() => { close(); route.onReroute(id); }, 900); return true;
  }
  async function camStart() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert("This browser can't open the camera. Scan the board with your phone's camera app."); return; }
    S.scan = true; $('nxCam').hidden = false; $('nxCamMsg').textContent = 'पास के पीले QR बोर्ड को स्कैन करें · Point at any station QR board';
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
    catch { $('nxCamMsg').textContent = 'कैमरा की अनुमति दें · Allow the camera to scan'; return; }
    const v = $('nxVid'); v.srcObject = camStream; try { await v.play(); } catch { /* ignore */ }
    const det = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    const jsQR = det ? null : (await import('jsqr')).default;
    const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
    const tick = async () => {
      if (!camStream) return;
      try {
        if (v.readyState >= 2) {
          let txt = null;
          if (det) { const c = await det.detect(v); if (c.length) txt = c[0].rawValue; }
          else { const w = v.videoWidth, h = v.videoHeight, k = Math.min(1, 640 / Math.max(w, h)); cv.width = Math.round(w * k); cv.height = Math.round(h * k); cx.drawImage(v, 0, 0, cv.width, cv.height); const img = cx.getImageData(0, 0, cv.width, cv.height); const c = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); if (c) txt = c.data; }
          if (txt) { const id = boardId(txt); if (id && onBoard(id)) return; }
        }
      } catch { /* keep trying */ }
      camT = setTimeout(tick, 200);
    };
    tick();
  }

  let wake = null;
  async function begin(sim) {
    S.started = true; S.follow = true; S.said = {}; S.ok = {}; S.ask = -1; S.steps = 0; S.arrived = false; $('nxStartRow').hidden = true; $('nxRunRow').hidden = false; $('nxArrive').hidden = true;
    if (!sim) startSensors(); $('nxNote').hidden = true;
    try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch { wake = null; }
    if (sim) startSim(); else { if (!LOCK) startGps(); srcText(); setTimeout(srcText, 3000); }
    const first = moves[0] && moves[0].d < 10 ? moves[0] : null;
    const intro = first ? first : { hi: `${route.dest.nameHi || route.dest.name} की ओर चलें`, en: `Head towards ${route.dest.name}` };
    if (first) S.said['0:now'] = S.said['0:pre'] = 1;
    say(`नेविगेशन शुरू। ${route.dest.nameHi || route.dest.name} तक ${distHi(roundStep(total))}। ${intro.hiNow || intro.hi}`, `Starting navigation. ${distEn(roundStep(total))} to ${route.dest.name}. ${intro.enNow || intro.en}`, true);
    if (map) { const p0 = path.ll(S.target); map.easeTo({ center: [p0[1], p0[0]], zoom: 19.3, pitch: 50, duration: 700 }); }
    if (!raf) raf = requestAnimationFrame(loop);
  }
  function end() { stopSources(); camStop(); $('nxNote').hidden = false; $('nxScan').hidden = false; $('nxCk').hidden = true; S.started = false; $('nxStartRow').hidden = false; $('nxRunRow').hidden = true; $('nxSpeed').hidden = true; $('nxRecenter').hidden = true; try { if (wake) wake.release(); } catch { /* ignore */ } wake = null; try { synth && synth.cancel(); } catch { /* ignore */ } render(); overview(); }

  // ---------- animation: glide the arrow and the camera, like a street-map app ----------
  let lastT = performance.now(), lastLine = 0;
  function camPad() { const H = el.clientHeight, top = el.querySelector('.nx-top'), sh = $('nxSheet'), vt = top ? top.getBoundingClientRect().bottom - el.getBoundingClientRect().top : 120, sb = sh ? Math.min(H * .6, sh.offsetHeight) : 200, vb = H - sb, y = vt + (vb - vt) * .72; return { top: Math.max(0, Math.round(2 * y - vb)), bottom: Math.round(sb), left: 0, right: 0 }; }
  function loop(now) {
    raf = 0; if (!document.body.contains(el)) return;
    const dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
    const gap = S.target - S.shown; S.shown += Math.abs(gap) < .05 ? gap : gap * Math.min(1, dt * (S.sim ? 6 : 2.2));
    const d = S.shown, ll = path.ll(d), br = path.bearing(d);
    if (br != null) S.bearing = S.bearing == null ? br : norm(S.bearing + angDiff(S.bearing, br) * Math.min(1, dt * 3));
    if (map && me) {
      const offRoute = S.started && !S.sim && S.raw && S.off > Math.max(30, (S.acc || 0) * 1.1);
      const pos = offRoute ? S.raw : ll, headOk = S.headSm != null && Date.now() - S.headT < 3000; me.setLngLat([pos[1], pos[0]]); me.setRotation(headOk && !S.sim ? S.headSm : (S.bearing || 0));
      me.getElement().classList.toggle('walk', S.started && (S.sim || Date.now() - S.stepT < 1500));
      me.getElement().classList.toggle('stale', S.started && !S.sim && Date.now() - Math.max(S.fixT, S.stepT) > 15000);
      const ac = me.getElement().querySelector('.acc'); if (ac && map) { const mpp = 156543.03 * Math.cos(rad(pos[0])) / 2 ** map.getZoom(); const px = Math.min(300, (S.sim ? 0 : (S.acc || 0)) / mpp * 2); ac.style.width = ac.style.height = px + 'px'; }
      if (S.started && S.follow && !S.touch) { const cb = S.orient === 'north' ? 0 : S.orient === 'heading' && headOk && !S.sim ? S.headSm : (S.bearing || 0); map.jumpTo({ center: [pos[1], pos[0]], bearing: cb, zoom: Math.max(16.5, Math.min(21, map.getZoom())), padding: camPad() }); }
      if (now - lastLine > 200 && map.getSource('nx-todo')) { lastLine = now; map.getSource('nx-done').setData(routeGeo(0, Math.max(.01, d))); map.getSource('nx-todo').setData(routeGeo(d, total)); }
    }
    speakFor(S.shown); render();
    if (S.started || Math.abs(S.target - S.shown) > .05) raf = requestAnimationFrame(loop);
    else if (map && me && S.headSm != null && Date.now() - S.headT < 3000) me.setRotation(S.headSm);
  }

  // ---------- buttons ----------
  $('nxGo').addEventListener('click', () => begin(false));
  $('nxDemo').addEventListener('click', () => { S.target = S.shown = 0; begin(true); });
  $('nxStop').addEventListener('click', end);
  $('nxCkYes').addEventListener('click', iAmHere);
  $('nxThumb').addEventListener('click', () => openPhoto(thumbFor)); $('nxLbX').addEventListener('click', () => { $('nxLb').hidden = true; });
  $('nxLb').addEventListener('click', (e) => { if (e.target.id === 'nxLb') $('nxLb').hidden = true; });
  $('nxCkScan').addEventListener('click', camStart); $('nxScan').addEventListener('click', camStart); $('nxCamX').addEventListener('click', camStop);
  $('nxSpeed').addEventListener('click', () => { S.simSpeed = S.simSpeed < 2 ? 4 : S.simSpeed < 5 ? 8 : 1.3; $('nxSpeed').textContent = S.simSpeed < 2 ? '1×' : S.simSpeed < 5 ? '3×' : '6×'; });
  $('nxRecenter').addEventListener('click', () => { S.follow = true; $('nxRecenter').hidden = true; if (map && map.getZoom() < 18) map.easeTo({ zoom: 19.3, pitch: 50, duration: 500 }); if (!raf) raf = requestAnimationFrame(loop); });
  const ORI = { heading: ['मेरी दिशा', 'My direction'], route: ['रास्ते की दिशा', 'Route ahead'], north: ['उत्तर ऊपर', 'North up'] };
  function updOrient() { const b = $('nxCompass'); b.dataset.o = S.orient; const t = ORI[S.orient]; b.title = `${t[1]} · ${t[0]}`; b.setAttribute('aria-label', `Map turns: ${t[1]}`); b.querySelector('span').textContent = S.orient === 'heading' ? '◉' : S.orient === 'route' ? '↟' : 'N'; }
  $('nxCompass').addEventListener('click', () => { S.orient = S.orient === 'heading' ? 'route' : S.orient === 'route' ? 'north' : 'heading'; store.set('wf-nav-orient', S.orient); updOrient(); const t = ORI[S.orient]; $('nxToast').textContent = `${t[0]} · ${t[1]}`; $('nxToast').hidden = false; clearTimeout(S.toastT); S.toastT = setTimeout(() => { $('nxToast').hidden = true; }, 1600); S.follow = true; $('nxRecenter').hidden = true; if (map && !S.started) map.easeTo({ bearing: S.orient === 'north' ? 0 : S.orient === 'heading' && S.headSm != null ? S.headSm : (path.bearing(S.shown) || 0), duration: 400 }); if (!raf) raf = requestAnimationFrame(loop); });
  updOrient();
  $('nxOverview').addEventListener('click', () => { S.follow = false; if (S.started) $('nxRecenter').hidden = false; overview(); });
  $('nxVoice').addEventListener('click', () => { S.voice = !S.voice; store.set('wf-nav-voice', S.voice ? '1' : '0'); updVoiceBtn(); if (!S.voice) { try { synth.cancel(); } catch { /* ignore */ } } else say('आवाज़ चालू', 'Voice on'); });
  $('nxLang').addEventListener('click', () => { S.lang = S.lang === 'hi' ? 'en' : 'hi'; store.set('wf-nav-lang', S.lang); updLangBtn(); render(); say('हिंदी में निर्देश', 'Directions in English', true); });
  $('nxBase').addEventListener('click', () => setBase(S.base === 'sat' ? 'map' : 'sat'));
  const close = () => { end(); if (raf) cancelAnimationFrame(raf); raf = 0; try { map && map.remove(); } catch { /* ignore */ } el.remove(); document.body.classList.remove('navx-on'); document.removeEventListener('keydown', onKey); if (route.onClose) route.onClose(); };
  const onKey = (e) => { if (e.key === 'Escape') { if (!$('nxLb').hidden) $('nxLb').hidden = true; else if (S.scan) camStop(); else close(); } }; document.addEventListener('keydown', onKey);
  $('nxClose').addEventListener('click', close); $('nxDone').addEventListener('click', close);
  if (LOCK) { $('nxNote').textContent = 'Works offline. The arrow stays on your route and moves with your steps; it corrects itself at each turn. Tap ✓ at stairs, or scan a QR board, if it is ahead or behind. · ऑफ़लाइन चलता है: तीर आपके रास्ते पर रहता है और हर मोड़ पर ठीक हो जाता है। सीढ़ियों पर ✓ दबाएँ।'; }
  moves.forEach((m) => { if (m.ph && m.ph.url) fetch(m.ph.url).catch(() => {}); });
  render();
  return { close, state: S, moves, line: route.line, level: route.level };
}
