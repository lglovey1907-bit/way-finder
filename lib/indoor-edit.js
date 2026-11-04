// Staff map editor (Mappedin-style): draw the station on the satellite photo, floor by floor.
//   Walkway  — tap along where people really walk; routes follow these lines exactly.
//   Space    — tap the corners of a platform, concourse, FOB deck, room, shop…
//   Stairs / lift / escalator — tap the end on this floor, pick the other floor, tap the other end.
//   Select   — tap anything to edit it: drag corners, tap + to add a corner, rename, delete.
// ctx: { L, bases(), load()→map|null, save(map)→Promise, prefill()→map, facs()→[{id,name,ll,lv,color,code}],
//        qrs()→[{id,name,ll,lv}], setFac(id,{lv,ll}), setQr(id,{lv,ll}), boundary()→[[lat,lng]], canWrite() }
import * as I from './indoor';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rid = (p) => p + Math.random().toString(36).slice(2, 9);
const r7 = (ll) => [+(+ll[0]).toFixed(7), +(+ll[1]).toFixed(7)];
const clone = (o) => JSON.parse(JSON.stringify(o));

export function createEditor(root, ctx) {
  const L = ctx.L;
  const E = { map: null, saved: '', lv: 'g', tool: 'select', draft: null, sel: null, selV: null, kind: 'platform', linkKind: 'stairs', undo: [], route: null, msg: '', err: false, busy: false, showChecks: false };
  root.innerHTML = `<div class="ime">
    <div class="ime-mapw"><div class="ime-map" id="imeMap"></div>
      <div class="ime-floors" id="imeFloors" role="group" aria-label="Floor"></div>
      <div class="ime-hint" id="imeHint" role="status"></div></div>
    <div class="ime-side">
      <div class="ime-tools" role="group" aria-label="Tool">
        <button type="button" data-tool="select">☝ Select</button><button type="button" data-tool="walk">〰 Walkway</button>
        <button type="button" data-tool="space">▱ Space</button><button type="button" data-tool="link">⇅ Stairs / lift</button></div>
      <div id="imeTool"></div>
      <div id="imeSel"></div>
      <details class="ime-box" id="imeShowBox" open><summary>Show on this map</summary><div id="imeShow"></div></details>
      <details class="ime-box" id="imeFloorBox"><summary>Floors</summary><div id="imeFloorEd"></div></details>
      <details class="ime-box" id="imeLookBox"><summary>Look of the map</summary><div id="imeLook"></div></details>
      <details class="ime-box" id="imeCheckBox"><summary>Check the map <span id="imeCheckSum"></span></summary><div id="imeChecks"></div></details>
      <details class="ime-box" id="imeRouteBox"><summary>Set routes <span id="imeRouteSum"></span></summary><div id="imeRoutes"></div></details>
      <details class="ime-box" id="imeTestBox"><summary>Test a route</summary><div id="imeTest"></div></details>
      <div class="ime-save">
        <label class="ime-live"><input type="checkbox" id="imeLive"> Passengers use this map</label>
        <div class="actions"><button class="btn primary" type="button" id="imeSave">Save map</button><button class="btn" type="button" id="imeUndo">↶ Undo</button>
          <button class="btn" type="button" id="imeFill">Fill from site survey</button></div>
        <p class="msg" id="imeMsg" role="status"></p></div>
    </div></div>`;
  const $ = (id) => root.querySelector('#' + id);

  // ---------- map ----------
  const lmap = L.map($('imeMap'), { zoomControl: true, maxZoom: 22, doubleClickZoom: false, zoomSnap: 0.25 }).setView([28.6425, 77.2195], 17);
  const bases = ctx.bases(); bases['Satellite'].addTo(lmap); L.control.layers(bases, {}, { position: 'topright' }).addTo(lmap); L.control.scale({ imperial: false }).addTo(lmap);
  const G = {}; ['ghost', 'spaces', 'paths', 'links', 'labels', 'survey', 'facs', 'route', 'edit', 'draft'].forEach((k) => (G[k] = L.layerGroup().addTo(lmap)));
  // "Show on this map": names and Record on site points, for staff working on the drawing (saved on this device only)
  const SHOW_KINDS = [['fobnum', 'FOB point numbers (B1·1, B1·2… as in Record on site)'], ['pf', 'Platform numbers'], ['fob', 'Foot over bridge names'], ['area', 'Concourse and hall names'], ['fac', 'Amenity names'], ['pillar', 'Pillar numbers'], ['point', 'Point names (gates, QR boards)'], ['survey', 'Other points from Record on site (platform ends, gates, entries)']];
  const SHOW = Object.assign({ fobnum: true, pf: true, fob: true, area: false, fac: false, pillar: false, point: true, survey: false }, (() => { try { return JSON.parse(localStorage.getItem('wf-ed-show') || '{}'); } catch { return {}; } })());
  const tag = (ll, text, cls) => L.marker(ll, { icon: L.divIcon({ className: 'ime-tag ' + (cls || ''), html: `<span>${esc(text)}</span>`, iconSize: [0, 0] }), interactive: false, keyboard: false, zIndexOffset: 300 });
  lmap.on('click', (e) => onMapClick([e.latlng.lat, e.latlng.lng]));
  lmap.on('mousemove', (e) => { if (E.draft && E.draft.pts.length) drawDraft([e.latlng.lat, e.latlng.lng]); });

  const M = () => E.map;
  const sig = () => JSON.stringify(E.map);
  const dirty = () => sig() !== E.saved;
  function change(fn) { E.undo.push(sig()); if (E.undo.length > 40) E.undo.shift(); fn(); E.route = null; render(); }
  const lvItems = (lv) => ({ spaces: M().spaces.filter((s) => s.lv === lv), paths: M().paths.filter((p) => p.lv === lv) });
  const levelName = (id) => (I.levelOf(M(), id) || { name: id }).name;
  const icon = (cls, txt) => L.divIcon({ className: 'ime-pin ' + cls, html: `<b>${esc(txt || '')}</b>`, iconSize: null });

  // snap a tap to an existing corner or line on this floor, so walkways join up
  function snapLL(ll, what) {
    const F = I.frame(ll); const p = [0, 0]; let best = null;
    const pool = what === 'space' ? M().spaces.filter((s) => s.lv === E.lv).map((s) => ({ pts: s.pts, closed: true })) : M().paths.filter((q) => q.lv === E.lv).map((q) => ({ pts: q.pts, closed: false }));
    const vr = what === 'space' ? 1.5 : 3, lr = what === 'space' ? 1 : 2;
    pool.forEach((o) => o.pts.forEach((q) => { const d = Math.hypot(...F.to(q)); if (d < vr && (!best || d < best.d)) best = { d, ll: q, v: true }; }));
    if (best) return best.ll;
    pool.forEach((o) => { const n = o.pts.length; for (let i = 0; i < n - (o.closed ? 0 : 1); i++) { const a = F.to(o.pts[i]), b = F.to(o.pts[(i + 1) % n]); const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2)); const x = a[0] + vx * t, y = a[1] + vy * t, d = Math.hypot(x, y); if (d < lr && (!best || d < best.d)) best = { d, ll: F.ll(x, y) }; } });
    return best ? best.ll : r7(ll);
  }

  function onMapClick(ll) {
    if (E.rd && E.rdPick) { const s = I.snap(E.graph || I.buildGraph(M()), E.lv, ll); if (!s || s.d > 25) { hint('Tap on or next to a walkway.'); return; } E.rd.via.push({ lv: E.lv, ll: s.ll }); rdPreview(); render(); return; }
    if (!ctx.canWrite()) return;
    if (E.tool === 'walk' || E.tool === 'space') { if (!E.draft) E.draft = { type: E.tool, pts: [] }; E.draft.pts.push(snapLL(ll, E.tool)); renderTool(); drawDraft(); return; }
    if (E.tool === 'link') {
      if (!E.draft) { E.draft = { type: 'link', a: { lv: E.lv, ll: r7(ll) }, toLv: (M().levels.find((l) => l.id !== E.lv) || {}).id }; renderTool(); drawDraft(); return; }
      if (E.draft.b) return; if (E.lv === E.draft.a.lv) { hint('Switch to the other floor first (buttons on the map), then tap the other end.'); return; }
      const d = E.draft; change(() => { const k = { id: rid('k'), kind: E.linkKind, name: d.name || '', a: d.a, b: { lv: E.lv, ll: r7(ll) } }; M().links.push(k); E.sel = { t: 'link', id: k.id }; E.draft = null; E.tool = 'select'; }); return;
    }
    if (E.sel) { E.sel = null; E.selV = null; render(); }
  }
  function finishDraft() {
    const d = E.draft; if (!d) return;
    if (d.type === 'walk' && d.pts.length >= 2) change(() => { const p = { id: rid('w'), lv: E.lv, pts: d.pts }; M().paths.push(p); E.draft = null; });
    else if (d.type === 'space' && d.pts.length >= 3) change(() => { const s = { id: rid('s'), lv: E.lv, kind: E.kind, name: (d.name || '').trim(), pts: d.pts }; M().spaces.push(s); E.draft = null; E.sel = { t: 'space', id: s.id }; E.tool = 'select'; });
    else { hint(d.type === 'walk' ? 'A walkway needs at least 2 points.' : 'A space needs at least 3 corners.'); return; }
  }

  // ---------- drawing ----------
  function drawDraft(mouse) {
    G.draft.clearLayers(); const d = E.draft; if (!d) return;
    if (d.type === 'link') { if (d.a.lv === E.lv) L.marker(d.a.ll, { icon: icon('ime-link-pin', '⇅'), interactive: false }).addTo(G.draft); else L.marker(d.a.ll, { icon: icon('ime-link-pin ghost', '⇅'), interactive: false }).addTo(G.draft); return; }
    const pts = mouse ? d.pts.concat([mouse]) : d.pts;
    if (d.type === 'walk') L.polyline(pts, { color: '#E8710A', weight: 5, dashArray: '8 6', interactive: false }).addTo(G.draft);
    else L.polygon(pts, { color: '#E8710A', weight: 3, dashArray: '6 5', fillOpacity: 0.15, interactive: false }).addTo(G.draft);
    d.pts.forEach((q, i) => L.marker(q, { icon: icon('ime-v draft', String(i + 1)), interactive: false }).addTo(G.draft));
  }
  function render() {
    if (!M()) return;
    Object.values(G).forEach((g) => g.clearLayers());
    const lv = E.lv, canW = ctx.canWrite();
    // other floors, faint
    M().paths.filter((p) => p.lv !== lv).forEach((p) => L.polyline(p.pts, { color: '#5F6368', weight: 2, opacity: 0.45, dashArray: '3 5', interactive: false }).addTo(G.ghost));
    M().spaces.filter((s) => s.lv !== lv && s.kind !== 'building').forEach((s) => L.polygon(s.pts, { color: '#5F6368', weight: 1, opacity: 0.35, fill: false, dashArray: '2 4', interactive: false }).addTo(G.ghost));
    if (!M().spaces.some((s) => s.kind === 'stationarea')) (ctx.boundary() || []).forEach((b) => L.polygon(b, { color: '#111', weight: 2, dashArray: '6 6', fill: false, interactive: false }).addTo(G.ghost));
    // spaces
    M().spaces.filter((s) => s.lv === lv || (s.kind === 'stationarea' && s.lv !== lv)).forEach((s) => { const st = I.styleOf(s, M().style), on = E.sel && E.sel.t === 'space' && E.sel.id === s.id, outline = I.OUTLINE(s.kind);
      if (s.kind === 'building') L.polygon(s.pts, { color: '#5F6368', weight: (on ? 4 : 3) + 3, fill: false, interactive: false }).addTo(G.spaces);
      const lay = L.polygon(s.pts, outline ? { color: on ? '#E8710A' : st.line, weight: on ? 4 : 3, fillColor: st.fill, fillOpacity: s.kind === 'stationarea' ? 0 : 0.15, dashArray: on ? '8 6' : null }
        : { color: on ? '#E8710A' : st.line, weight: on ? 3 : 1.2, fillColor: st.fill, fillOpacity: on ? 0.8 : 0.7 }).addTo(G.spaces);
      if (s.name) lay.bindTooltip(esc(s.name), { permanent: false, direction: 'center', className: 'ime-tip' });
      lay.on('click', (ev) => { L.DomEvent.stop(ev); if (E.tool !== 'select' || (E.rd && E.rdPick)) return onMapClick([ev.latlng.lat, ev.latlng.lng]); select('space', s.id); }); });
    // walkways
    M().paths.filter((p) => p.lv === lv).forEach((p) => { const on = E.sel && E.sel.t === 'path' && E.sel.id === p.id;
      L.polyline(p.pts, { color: '#fff', weight: on ? 9 : 7, opacity: 0.9, interactive: false }).addTo(G.paths);
      const lay = L.polyline(p.pts, { color: on ? '#E8710A' : '#1A73E8', weight: on ? 5 : 4 }).addTo(G.paths);
      lay.on('click', (ev) => { L.DomEvent.stop(ev); if (E.tool !== 'select' || (E.rd && E.rdPick)) return onMapClick([ev.latlng.lat, ev.latlng.lng]); select('path', p.id); });
      // one-way walkway: arrows along it, in the walking direction
      if (p.dir === 'fwd' || p.dir === 'back') for (let i = 1; i < p.pts.length; i++) { let a = p.pts[i - 1], b = p.pts[i]; if (p.dir === 'back') [a, b] = [b, a]; if (I.metres(a, b) < 3) continue;
        const ang = Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI, mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        L.marker(mid, { icon: L.divIcon({ className: 'ime-oneway', html: `<span style="transform:rotate(${ang}deg)">➜</span>`.replace('➜', '▲'), iconSize: [16, 16] }), interactive: false, zIndexOffset: 400 }).addTo(G.paths); } });
    // names: platforms, bridges, concourses
    M().spaces.filter((s) => s.lv === lv && s.name && s.pts && s.pts.length >= 3).forEach((s) => {
      const k = s.kind === 'platform' ? 'pf' : s.kind === 'fob' ? 'fob' : ['concourse', 'hall', 'waiting', 'ticket'].includes(s.kind) ? 'area' : null; if (!k || !SHOW[k]) return;
      if (k !== 'pf' && s.label === false) return;
      tag(I.centroid(s.pts), k === 'pf' ? String(s.name).replace(/^platform\s*/i, 'PF ') : s.name, 'k-' + k).addTo(G.labels); });
    // Record on site: platform ends, bend points, bridge points, gates, entries, pillars (look only; edit them in Record on site)
    // bridge points numbered as in Record on site: full on the bridge floor, faint on the others
    if (SHOW.fobnum) (ctx.surveyPts ? ctx.surveyPts() : []).filter((p) => p.t === 'fob').forEach((p) => {
      L.marker(p.ll, { icon: L.divIcon({ className: 'svpin svpin-fob ime-fobn' + (p.lv === lv ? '' : ' off'), html: `<b>${esc(p.label)}</b>`, iconSize: null }), keyboard: false, interactive: p.lv === lv, zIndexOffset: p.lv === lv ? 800 : 100, title: p.title }).addTo(G.survey); });
    if (SHOW.survey || SHOW.pillar) (ctx.surveyPts ? ctx.surveyPts() : []).filter((p) => p.lv === lv && p.t !== 'fob' && (p.t === 'pillar' ? SHOW.pillar : SHOW.survey)).forEach((p) => {
      L.marker(p.ll, { icon: L.divIcon({ className: 'ime-svp k-' + p.t, html: `<i></i><span>${esc(p.label)}</span>`, iconSize: [0, 0] }), keyboard: false, zIndexOffset: 250, title: p.title }).addTo(G.survey); });
    // stairs, lifts, escalators
    M().links.forEach((k) => { const on = E.sel && E.sel.t === 'link' && E.sel.id === k.id, sym = (k.dir === 'up' ? '▲' : k.dir === 'down' ? '▼' : '') + (k.kind === 'lift' ? '⇕' : k.kind === 'esc' ? '↗' : k.kind === 'ramp' ? '◿' : '≡');
      ['a', 'b'].forEach((w) => { const end = k[w]; if (end.lv !== lv) return; const m = L.marker(end.ll, { icon: icon('ime-link-pin' + (on ? ' on' : ''), sym), draggable: on && canW, zIndexOffset: 700, title: `${I.LINK[k.kind] ? I.LINK[k.kind].label : 'Link'} to ${levelName(k[w === 'a' ? 'b' : 'a'].lv)}` }).addTo(G.links);
        m.on('click', (ev) => { L.DomEvent.stop(ev); select('link', k.id); }); m.on('dragend', () => { const q = m.getLatLng(); change(() => { end.ll = snapLL([q.lat, q.lng], 'walk'); }); }); });
      if (k.a.lv === lv || k.b.lv === lv) L.polyline([k.a.ll, k.b.ll], { color: '#8E24AA', weight: 2, dashArray: '4 4', interactive: false }).addTo(G.links); });
    // facilities and QR boards on this floor
    (ctx.facs() || []).filter((a) => (a.lv || 'g') === lv).forEach((a) => { const on = E.sel && E.sel.t === 'fac' && E.sel.id === a.id;
      const m = L.marker(a.ll, { icon: icon('ime-fac' + (on ? ' on' : ''), a.code || '•'), draggable: on && canW, title: a.name, zIndexOffset: 500 }).addTo(G.facs);
      m.getElement && setTimeout(() => { const el = m.getElement(); if (el) el.querySelector('b').style.background = a.color || '#546E7A'; }, 0);
      m.on('click', (ev) => { L.DomEvent.stop(ev); select('fac', a.id); }); m.on('dragend', () => { const q = m.getLatLng(); ctx.setFac(a.id, { ll: r7([q.lat, q.lng]) }); });
      const txt = [SHOW.fac ? a.name : '', SHOW.pillar && a.pillar ? String(a.pillar).replace(/^pillar\s*[-:]?\s*/i, 'P ') : ''].filter(Boolean).join(' · '); if (txt) m.bindTooltip(txt, { permanent: true, direction: 'right', offset: [10, 0], className: 'ime-tt' + (SHOW.fac ? '' : ' small') }); });
    (ctx.qrs() || []).filter((q) => (q.lv || 'g') === lv).forEach((q) => { const on = E.sel && E.sel.t === 'qr' && E.sel.id === q.id;
      const m = L.marker(q.ll, { icon: icon('ime-qr' + (on ? ' on' : ''), 'QR'), title: q.name, zIndexOffset: 600 }).addTo(G.facs); m.on('click', (ev) => { L.DomEvent.stop(ev); select('qr', q.id); }); if (SHOW.point) m.bindTooltip(q.name + (q.use === 'entry' ? ' · ENTRY only' : q.use === 'exit' ? ' · EXIT only' : '') + (q.pax === 'reserved' ? ' · Reserved' : q.pax === 'unreserved' ? ' · Unreserved' : ''), { permanent: true, direction: 'right', offset: [12, 0], className: 'ime-tt qr' }); });
    // via points of the route being set
    if (E.rd) E.rd.via.forEach((v, i) => { if (v.lv !== lv) return; const m = L.marker(v.ll, { icon: icon('ime-via', String(i + 1)), draggable: true, zIndexOffset: 950, title: 'Drag to move this stop' }).addTo(G.edit); m.on('dragend', () => { const q = m.getLatLng(), s = I.snap(E.graph, lv, [q.lat, q.lng]); if (s) v.ll = s.ll; rdPreview(); render(); }); });
    // test route
    if (E.route) { const pts = E.route.pts; for (let i = 1; i < pts.length; i++) { const same = pts[i].lv === lv && pts[i - 1].lv === lv; L.polyline([pts[i - 1].ll, pts[i].ll], { color: same ? '#0B8043' : '#0B8043', weight: same ? 7 : 3, opacity: same ? 0.95 : 0.5, dashArray: same ? null : '5 6', interactive: false }).addTo(G.route); } }
    editHandles(); drawDraft(); renderFloors(); renderTool(); renderSel(); renderSave();
  }
  // corners of the selected walkway or space: drag to move, tap to select, tap + to add one
  function editHandles() {
    if (!E.sel || !ctx.canWrite() || (E.sel.t !== 'path' && E.sel.t !== 'space')) return;
    const it = (E.sel.t === 'path' ? M().paths : M().spaces).find((x) => x.id === E.sel.id); if (!it || (it.lv !== E.lv && it.kind !== 'stationarea')) return;
    const closed = E.sel.t === 'space', n = it.pts.length;
    it.pts.forEach((q, i) => { const m = L.marker(q, { icon: icon('ime-v' + (E.selV === i ? ' sel' : ''), String(i + 1)), draggable: true, zIndexOffset: 900 }).addTo(G.edit);
      let start = null; m.on('dragstart', () => { start = it.pts[i].slice(); E.undo.push(sig()); });
      m.on('dragend', () => { const ll = m.getLatLng(), to = snapLLExcept([ll.lat, ll.lng], it); const F = I.frame(start);
        // corners of other walkways sitting on this one move with it, so junctions stay joined
        if (!closed) M().paths.forEach((p) => { if (p.lv !== it.lv) return; p.pts.forEach((v, j) => { if (p === it && j === i) return; if (Math.hypot(...F.to(v)) < 0.6) p.pts[j] = to; }); });
        it.pts[i] = to; E.selV = i; E.route = null; render(); });
      m.on('click', (ev) => { L.DomEvent.stop(ev); E.selV = E.selV === i ? null : i; render(); }); });
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) { const a = it.pts[i], b = it.pts[(i + 1) % n], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const m = L.marker(mid, { icon: icon('ime-mid', '+'), zIndexOffset: 800, title: 'Add a corner here' }).addTo(G.edit);
      m.on('click', (ev) => { L.DomEvent.stop(ev); change(() => { it.pts.splice(i + 1, 0, r7(mid)); E.selV = i + 1; }); }); }
  }
  function snapLLExcept(ll, it) { const keep = it.pts; it.pts = []; const r = snapLL(ll, E.sel.t === 'space' ? 'space' : 'walk'); it.pts = keep; return r; }

  function select(t, id) { E.sel = { t, id }; E.selV = null; if (E.tool !== 'select') { E.tool = 'select'; E.draft = null; } render(); }
  function hint(t) { const h = $('imeHint'); h.textContent = t || ''; h.hidden = !t; }

  // ---------- side panel ----------
  function renderFloors() {
    const L0 = M().levels.slice().sort((a, b) => (b.z || 0) - (a.z || 0));
    $('imeFloors').innerHTML = L0.map((l) => `<button type="button" data-lv="${esc(l.id)}" aria-pressed="${l.id === E.lv}" title="${esc(l.hi || '')}">${esc(l.name)}<small>${lvItems(l.id).paths.length} walkways</small></button>`).join('');
    $('imeFloorEd').innerHTML = `${M().levels.slice().sort((a, b) => (a.z || 0) - (b.z || 0)).map((l) => { const used = lvItems(l.id).paths.length + lvItems(l.id).spaces.length + M().links.filter((k) => k.a.lv === l.id || k.b.lv === l.id).length;
      return `<div class="ime-frow"><input data-fl="${esc(l.id)}" data-fk="name" value="${esc(l.name)}" aria-label="Floor name"><input data-fl="${esc(l.id)}" data-fk="hi" value="${esc(l.hi || '')}" placeholder="हिंदी" aria-label="Hindi name"><input data-fl="${esc(l.id)}" data-fk="z" type="number" step="1" value="${l.z || 0}" title="Order: 0 = ground, 1 = one floor up, -1 = basement" aria-label="Floor order"><button class="btn sm" type="button" data-fdel="${esc(l.id)}" ${used ? 'disabled title="Remove its walkways, spaces and stairs first"' : ''}>Delete</button></div>`; }).join('')}
      <p class="msg">Order: 0 = ground, 1 = FOB / first floor, 2 = second floor, −1 = basement.</p><button class="btn sm" type="button" id="imeAddFloor">+ Add a floor</button>`;
  }
  function renderTool() {
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === E.tool)));
    const d = E.draft, t = E.tool, ro = !ctx.canWrite(); let h = '';
    if (ro) h = '<p class="msg err">Staff sign-in with edit rights is needed to change the map.</p>';
    else if (t === 'select') h = '<p class="msg">Tap a walkway, space, stairs, facility or QR board to edit it. Tap the black boundary or a space to change its corners, colour and shade.</p>' + (!M().spaces.some((s) => s.kind === 'stationarea') && (ctx.boundary() || []).length ? '<div class="actions"><button class="btn sm" type="button" id="imeTakeB">Make the black station boundary editable</button></div>' : '');
    else if (t === 'walk') h = `<p class="msg"><b>Walkway on ${esc(levelName(E.lv))}:</b> tap along the middle of where people walk. Taps near another walkway join onto it. Draw a walkway across every platform, concourse and bridge, and from every gate.</p>
      ${d ? `<div class="actions"><button class="btn primary" type="button" id="imeFin" ${d.pts.length < 2 ? 'disabled' : ''}>✓ Finish walkway (${d.pts.length} points)</button><button class="btn" type="button" id="imeBack">Undo point</button><button class="btn" type="button" id="imeCancel">Cancel</button></div>` : ''}`;
    else if (t === 'space') h = `<div class="two"><div class="field"><label for="imeKind">What is it</label><select id="imeKind">${I.KINDS.map((k) => `<option value="${k[0]}" ${k[0] === E.kind ? 'selected' : ''}>${esc(k[1])}</option>`).join('')}</select></div>
      <div class="field"><label for="imeDName">Name <small>(shown to passengers)</small></label><input id="imeDName" value="${esc(d && d.name || '')}" placeholder="e.g. Platform 4/5"></div></div>
      <p class="msg">Tap the corners on the map, then Finish.</p>${d ? `<div class="actions"><button class="btn primary" type="button" id="imeFin" ${d.pts.length < 3 ? 'disabled' : ''}>✓ Finish space (${d.pts.length} corners)</button><button class="btn" type="button" id="imeBack">Undo corner</button><button class="btn" type="button" id="imeCancel">Cancel</button></div>` : ''}`;
    else if (t === 'link') h = `<div class="field"><label for="imeLKind">Kind</label><select id="imeLKind">${I.LINKS.map((k) => `<option value="${k[0]}" ${k[0] === E.linkKind ? 'selected' : ''}>${k[1]}</option>`).join('')}</select></div>
      <p class="msg">${!d ? `1. Tap the end of the ${esc((I.LINK[E.linkKind] || {}).label || 'stairs').toLowerCase()} on <b>${esc(levelName(E.lv))}</b>, on its walkway.` : `2. Now switch to <b>${esc(levelName(d.toLv || ''))}</b> or another floor with the buttons on the map and tap the other end.`}</p>
      ${d ? `<div class="actions">${M().levels.filter((l) => l.id !== d.a.lv).map((l) => `<button class="btn sm" type="button" data-golv="${esc(l.id)}">Go to ${esc(l.name)}</button>`).join('')}<button class="btn" type="button" id="imeCancel">Cancel</button></div>` : ''}`;
    $('imeTool').innerHTML = h;
    hint(t === 'walk' ? (d ? 'Tap the next point. Finish when done.' : 'Tap where the walkway starts.') : t === 'space' ? (d ? 'Tap the next corner.' : 'Tap the first corner.') : t === 'link' ? (d ? 'Switch floor, then tap the other end.' : 'Tap one end of the stairs or lift.') : '');
  }
  function renderSel() {
    const s = E.sel, el = $('imeSel'); if (!s) { el.innerHTML = ''; return; } const ro = !ctx.canWrite() ? 'disabled' : '';
    if (s.t === 'space') { const it = M().spaces.find((x) => x.id === s.id); if (!it) { el.innerHTML = ''; return; }
      el.innerHTML = `<div class="ime-box open"><b>Space</b> · ${esc(levelName(it.lv))} · ${it.pts.length} corners<div class="two"><div class="field"><label for="imeSKind">What is it</label><select id="imeSKind" ${ro}>${I.KINDS.map((k) => `<option value="${k[0]}" ${k[0] === it.kind ? 'selected' : ''}>${esc(k[1])}</option>`).join('')}</select></div>
        <div class="field"><label for="imeSName">Name</label><input id="imeSName" value="${esc(it.name || '')}" ${ro}></div></div><div class="field"><label for="imeSHi">Name in Hindi <small>(optional)</small></label><input id="imeSHi" value="${esc(it.nameHi || '')}" ${ro}></div>
        ${colourHtml(it, ro)}
        <p class="msg">Drag the numbered corners. Tap + to add a corner. Tap a corner, then Delete corner.</p>
        <div class="actions">${E.selV != null ? `<button class="btn sm" type="button" id="imeDelV" ${ro}>Delete corner ${E.selV + 1}</button>` : ''}<button class="btn sm danger" type="button" id="imeDel" ${ro}>Delete ${it.kind === 'stationarea' ? 'boundary' : 'space'}</button></div></div>`; }
    else if (s.t === 'path') { const it = M().paths.find((x) => x.id === s.id); if (!it) { el.innerHTML = ''; return; } const len = it.pts.reduce((a, q, i) => (i ? a + I.metres(it.pts[i - 1], q) : 0), 0);
      el.innerHTML = `<div class="ime-box open"><b>Walkway</b> · ${esc(levelName(it.lv))} · ${Math.round(len)} m · ${it.pts.length} points
        ${M().levels.length > 1 ? `<div class="field"><label for="imeWLv">Floor</label><select id="imeWLv" ${ro}>${M().levels.map((l) => `<option value="${esc(l.id)}" ${l.id === it.lv ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select><small class="msg">Drawn on the wrong floor? Choose the right one; the walkway moves there.</small></div>` : ''}
        <div class="field"><label for="imeWDir">Direction</label><select id="imeWDir" ${ro}><option value="" ${!it.dir ? 'selected' : ''}>Both ways</option><option value="fwd" ${it.dir === 'fwd' ? 'selected' : ''}>One way ▲ (as the arrows show)</option><option value="back" ${it.dir === 'back' ? 'selected' : ''}>One way, the other direction</option></select><small class="msg">For an entry-only gate, make the walkway through the gate one way into the station; for exit only, out of it. Routes never go against the arrows.</small></div>
        <p class="msg">Drag points to follow the real walking line; corners of joining walkways move with it. Tap + to add a point.</p>
        <div class="actions">${E.selV != null ? `<button class="btn sm" type="button" id="imeDelV" ${ro}>Delete point ${E.selV + 1}</button><button class="btn sm" type="button" id="imeSplit" ${ro}>Split here</button>` : ''}<button class="btn sm" type="button" id="imeExtend" ${ro}>Continue drawing</button><button class="btn sm danger" type="button" id="imeDel" ${ro}>Delete walkway</button></div></div>`; }
    else if (s.t === 'link') { const k = M().links.find((x) => x.id === s.id); if (!k) { el.innerHTML = ''; return; } const info = (E.graph && E.graph.linkInfo[k.id]) || {};
      el.innerHTML = `<div class="ime-box open"><b>${esc((I.LINK[k.kind] || {}).label || 'Link')}</b> · ${esc(levelName(k.a.lv))} ${k.dir === 'up' || k.dir === 'down' ? '→' : '↔'} ${esc(levelName(k.b.lv))}${k.dir === 'up' ? ' · ▲ up only' : k.dir === 'down' ? ' · ▼ down only' : ''}
        <div class="two"><div class="field"><label for="imeLK">Kind</label><select id="imeLK" ${ro}>${I.LINKS.map((q) => `<option value="${q[0]}" ${q[0] === k.kind ? 'selected' : ''}>${q[1]}</option>`).join('')}</select></div><div class="field"><label for="imeLN">Name <small>(optional)</small></label><input id="imeLN" value="${esc(k.name || '')}" placeholder="e.g. FOB 1 stairs, PF 4/5" ${ro}></div></div>
        <div class="field"><label for="imeLDir">Direction</label><select id="imeLDir" ${ro}><option value="" ${!k.dir ? 'selected' : ''}>Both ways (up and down)</option><option value="up" ${k.dir === 'up' ? 'selected' : ''}>▲ Up only</option><option value="down" ${k.dir === 'down' ? 'selected' : ''}>▼ Down only</option></select><small class="msg">${k.kind === 'esc' ? 'Most escalators run one way: set it to match. ' : ''}Passengers are only sent the way it runs.</small></div>
        ${info.offA > 6 || info.offB > 6 ? '<p class="msg err">One end is far from a walkway, so routes may not use it. Drag it onto a walkway.</p>' : ''}
        <p class="msg">Drag the end on this floor onto its walkway. Switch floor to move the other end.</p><div class="actions"><button class="btn sm" type="button" data-golv="${esc(k.a.lv === E.lv ? k.b.lv : k.a.lv)}">Go to other end</button><button class="btn sm danger" type="button" id="imeDel" ${ro}>Delete</button></div></div>`; }
    else if (s.t === 'fac' || s.t === 'qr') { const list = s.t === 'fac' ? ctx.facs() : ctx.qrs(), it = list.find((x) => x.id === s.id); if (!it) { el.innerHTML = ''; return; }
      el.innerHTML = `<div class="ime-box open"><b>${s.t === 'fac' ? 'Facility' : 'QR board'}</b> · ${esc(it.name)}
        <div class="field"><label for="imeOLv">Floor</label><select id="imeOLv" ${ro}>${M().levels.map((l) => `<option value="${esc(l.id)}" ${l.id === (it.lv || 'g') ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
        ${s.t === 'qr' && it.gate ? `<div class="field"><label for="imeGUse">This gate is for</label><select id="imeGUse" ${ro}><option value="" ${!it.use ? 'selected' : ''}>Entry & exit</option><option value="entry" ${it.use === 'entry' ? 'selected' : ''}>Entry only · केवल प्रवेश</option><option value="exit" ${it.use === 'exit' ? 'selected' : ''}>Exit only · केवल निकास</option></select><label for="imeGPax" style="margin-top:8px">For which passengers</label><select id="imeGPax" ${ro}><option value="" ${!it.pax ? 'selected' : ''}>All passengers</option><option value="reserved" ${it.pax === 'reserved' ? 'selected' : ''}>Reserved passengers · आरक्षित</option><option value="unreserved" ${it.pax === 'unreserved' ? 'selected' : ''}>Unreserved (general) · अनारक्षित</option></select><small class="msg">Saved at once, also in Record on site. For routes, make the walkway through the gate one way (tap it → Direction).</small></div>` : ''}
        <p class="msg">${s.t === 'fac' ? 'Drag the marker to its door or counter. ' : ''}It should sit on or next to a walkway on its floor.</p></div>`; }
  }
  function colourHtml(it, ro) {
    const st = I.styleOf(it, M().style), outline = I.OUTLINE(it.kind), k = (I.KIND[it.kind] || I.KIND.other).label;
    return `<div class="ime-col"><label>${outline ? 'Line colour' : 'Area colour'} <input type="color" id="imeCFill" value="${outline ? st.rawLine : st.raw}" ${ro}></label>
      ${outline ? '' : `<label>Edge colour <input type="color" id="imeCLine" value="${st.rawLine}" ${ro}></label>`}
      ${outline ? '' : `<label class="ime-shade">Lighter <input type="range" id="imeCShade" min="0" max="1" step="0.05" value="${it.shade == null ? 0.5 : it.shade}" ${ro}> Darker</label>`}
      <span class="ime-sw" style="background:${outline ? st.line : st.fill}"></span></div>
      <div class="actions"><button class="btn sm" type="button" id="imeCReset" ${ro}>Default colour</button><button class="btn sm" type="button" id="imeCAll" ${ro}>Use for all ${esc(k.toLowerCase())}s</button></div>`;
  }
  function renderShow() { const el = $('imeShow'); if (!el || el.dataset.r) return; el.dataset.r = 1;
    el.innerHTML = `<div class="ime-lbls">${SHOW_KINDS.map(([k, t]) => `<label class="ime-live"><input type="checkbox" data-eshow="${k}" ${SHOW[k] ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div><p class="msg">Only for you, on this device. Passengers are not affected; what passengers see is under Look of the map.</p>`; }
  function renderLook() { renderShow();
    const s = M().style || {}, ro = !ctx.canWrite() ? 'disabled' : '';
    $('imeLook').innerHTML = `<label class="ime-shade">Whole map: lighter <input type="range" id="imeGShade" min="0" max="1" step="0.05" value="${s.shade == null ? 0.5 : s.shade}" ${ro}> darker</label>
      <label class="ime-shade">Walkway colour for passengers <input type="color" id="imeGWalk" value="${s.walk || '#7E97BD'}" ${ro}></label>
      <label class="ime-shade">Street map behind: faint <input type="range" id="imeGBg" min="0" max="1" step="0.05" value="${s.bg == null ? 0.32 : s.bg}" ${ro}> strong</label>
      <p class="msg">Passengers see these on their map and in navigation. Each space can also be made lighter or darker on its own (tap it).</p>
      <div class="field"><label>Labels passengers see on the map</label><div class="ime-lbls">${(ctx.labelKinds || []).map(([k, en, hi]) => { const L = Object.assign({}, ctx.labelDefaults || {}, M().labels || {}); return `<label class="ime-live"><input type="checkbox" data-plbl="${k}" ${L[k] ? 'checked' : ''} ${ro}> ${esc(en)} <small>${esc(hi)}</small></label>`; }).join('')}</div><small class="msg">Staff can show more on their own screen with the 🏷 button on the map. To hide one bridge or platform name, tap the space and untick “Show its name”. Tap Save map to apply.</small></div>`;
  }
  function renderSave() { renderLook();
    $('imeLive').checked = !!M().live; $('imeLive').disabled = !ctx.canWrite(); $('imeLive').closest('label').classList.toggle('off', !M().live);
    $('imeSave').disabled = !ctx.canWrite() || E.busy || !dirty(); $('imeUndo').disabled = !E.undo.length; $('imeFill').disabled = !ctx.canWrite();
    const m = $('imeMsg'); m.textContent = E.msg || (dirty() ? 'Unsaved changes.' : 'All changes saved.'); m.className = 'msg' + (E.err ? ' err' : dirty() ? '' : ' okm');
    const g = E.graph = I.buildGraph(M()), isl = I.islands(g), issues = checks(g, isl);
    $('imeCheckSum').textContent = issues.length ? `· ${issues.length} to fix` : '· all good';
    $('imeChecks').innerHTML = `<p class="msg">${M().paths.length} walkways · ${M().spaces.length} spaces · ${M().links.length} stairs/lifts · ${isl.length > 1 ? `<b>${isl.length} separate networks</b>` : 'one connected network'}</p>` +
      (issues.length ? `<div class="ime-issues">${issues.slice(0, 60).map((q, i) => `<div class="ime-issue"><span>${esc(q.t)}</span><button class="btn sm" type="button" data-show="${i}">Show</button></div>`).join('')}</div>` : '<p class="msg okm">Every facility and QR board can be reached.</p>');
    E.issues = issues; renderRoutes();
    const qrs = ctx.qrs(), facs = ctx.facs();
    $('imeTest').innerHTML = `<div class="field"><label for="imeTF">From QR board</label><select id="imeTF">${qrs.map((q) => `<option value="${esc(q.id)}" ${E.tf === q.id ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</select></div>
      <div class="field ime-ps"><label for="imeTQ">To <small>(any facility or platform: search by name, Hindi name, type or platform)</small></label><input id="imeTQ" type="search" autocomplete="off" placeholder="Search a place · स्थान खोजें" value="${esc(E.tt ? (ctx.placeName ? ctx.placeName(E.tt) : '') : '')}"><div class="hero-res ime-res" id="imeTRes" hidden></div></div>
      <label class="ime-live"><input type="checkbox" id="imeTSF" ${E.tsf ? 'checked' : ''}> Step-free (no stairs)</label>
      <div class="actions"><button class="btn sm primary" type="button" id="imeTGo">Show route</button>${E.route ? '<button class="btn sm" type="button" id="imeTClr">Clear</button>' : ''}</div>
      <p class="msg" id="imeTMsg">${E.route ? `${E.testSet ? `<b>${esc(E.testSet)}</b><br>` : ''}${Math.round(E.route.len)} m · ${E.route.pts.filter((p) => p.kind !== 'walk').length} floor changes. Green line: this floor; dashed: other floors.` : E.routeMsg || ''}</p>`;
  }
  // ---------- routes set by staff: "from this QR board to that place, go this way" ----------
  const destName = (key) => { const gn = ctx.groupName && ctx.groupName(key); if (gn) return gn; const d = (ctx.dests() || []).find((x) => x.key === key); return d ? d.name : 'a place that no longer exists'; };
  const pct = (v) => (v === '' || v == null ? '' : `${+v}%`);
  const qrName = (id) => (id === '*' ? 'Any QR board' : (ctx.groupName && ctx.groupName(id)) || ((ctx.qrs() || []).find((q) => q.id === id) || { name: id }).name);
  function rdPreview() {
    const d = E.rd; if (!d) return; const g = E.graph || I.buildGraph(M()); const grp = String(d.from).startsWith('area:') ? ((ctx.qrGroups ? ctx.qrGroups() : []).find((x) => x.key === d.from) || {}).first : null, qid = d.from === '*' ? E.tf || ((ctx.qrs() || [])[0] || {}).id : grp != null ? grp : d.from, q = (ctx.qrs() || []).find((x) => x.id === qid), to = ctx.targetOf(d.to, g);
    const wi = Math.min(E.rdWay || 0, Math.max(0, (d.ways || []).length - 1)), way = (d.ways || [])[wi];
    E.route = q && to ? (ctx.ruleRoute ? ctx.ruleRoute(d, way, g, { lv: q.lv || 'g', ll: q.ll }, to) : I.routeVia(g, { lv: q.lv || 'g', ll: q.ll }, d.via, to)) : null;
    E.rdMsg = !q || !to ? (String(d.from).startsWith('area:') && !q ? 'No QR board in this group has a map position yet.' : 'Choose where the route starts and ends.') : E.route ? `${way ? `Showing ${way.fob.replace(/foot over bridge/i, 'FOB')}: ` : ''}${Math.round(E.route.len)} m${d.from === '*' || grp ? ` (shown from ${q.name}${to.many ? ', to the nearest place in the group' : ''})` : to.many ? ' (to the nearest place in the group)' : ''}` : 'These stops can’t be joined by walkways. Move a stop onto a walkway, or draw the missing walkway.';
  }
  function renderRoutes() {
    const R = M().routes || [], ro = !ctx.canWrite() ? 'disabled' : '', el = $('imeRoutes'); if (!el) return;
    $('imeRouteSum').textContent = R.length ? `· ${R.length}` : '';
    if (!E.rd) {
      el.innerHTML = `<p class="msg">Decide which way passengers walk: e.g. from <b>Gate No 4</b> to <b>Platforms 2 to 16</b> through Platform 1, by FOB 3 (80%) or FOB 1 / FOB 2 (10% each). The most exact rule wins: one gate before “all Paharganj side”, one place before a range of platforms.</p>
        ${R.length ? `<div class="ime-issues">${R.map((r) => `<div class="ime-issue"><span><b>${esc(r.name || ((r.ways || []).length === 1 ? 'Via ' + r.ways[0].fob.replace(/foot over bridge/i, 'FOB') : (r.ways || []).length ? 'FOB split' : (r.via || []).some((v) => v.name) ? 'Via ' + r.via.filter((v) => v.name).map((v) => v.name).join(', ') : 'Route'))}</b>${r.main ? ' · main' : ''}<br><small>${esc(qrName(r.from))} → ${esc(destName(r.to))}${r.approach === 'pf1' ? ' · through the platform' : r.approach === 'concourse' ? ' · along the concourse' : r.approach === 'outside' ? ' · outside the station building' : ''}${(r.ways || []).length ? ' · ' + r.ways.map((w) => `${esc(w.fob.replace(/foot over bridge/i, 'FOB'))}${pct(w.share) ? ' ' + pct(w.share) : ''}${pct(w.rushShare) ? ` (rush ${pct(w.rushShare)})` : ''}`).join(', ') : ''}${r.via.length ? ` · ${r.via.length} extra stop${r.via.length === 1 ? '' : 's'}` : ''}${pct(r.share) ? ` · <b>${pct(r.share)}</b> of passengers` : ''}</small></span>
          <span class="actions"><button class="btn sm" type="button" data-rshow="${esc(r.id)}">Show</button><button class="btn sm" type="button" data-redit="${esc(r.id)}" ${ro}>Edit</button><button class="btn sm danger" type="button" data-rdel="${esc(r.id)}" ${ro}>Delete</button></span></div>`).join('')}</div>` : '<p class="msg"><i>No routes set yet: passengers get the shortest route.</i></p>'}
        <div class="actions"><button class="btn sm primary" type="button" id="imeRNew" ${ro}>+ Set a route</button></div>`;
      return;
    }
    const d = E.rd, qrs = ctx.qrs() || [], QG = (ctx.qrGroups ? ctx.qrGroups() : []).filter((x) => /area:(P|A)$/.test(x.key)), FOBS = ctx.fobNames ? ctx.fobNames() : [];
    const isPl = String(d.to).startsWith('plats:'), toMode = E.rdToMode || (d.to && !isPl ? 'one' : 'plats'), pr = isPl ? d.to.slice(6).split('-') : ['2', '16'];
    const pfOpt = (v) => Array.from({ length: 16 }, (_, i) => `<option ${String(i + 1) === String(v) ? 'selected' : ''}>${i + 1}</option>`).join('');
    const ways = d.ways || [], wOf = (n) => ways.find((w) => w.fob === n), ap = d.approach || 'auto';
    const radio = (name, v, cur, label, sub) => `<label class="ime-opt"><input type="radio" name="${name}" value="${v}" ${v === cur ? 'checked' : ''}><span><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</span></label>`;
    el.innerHTML = `<div class="ime-step"><span>1</span><div class="field"><label for="imeRFrom">Passenger scans at</label><select id="imeRFrom"><option value="*" ${d.from === '*' ? 'selected' : ''}>Any QR board</option>${QG.map((x) => `<option value="${esc(x.key)}" ${x.key === d.from ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<optgroup label="One gate / QR board">${qrs.map((q) => `<option value="${esc(q.id)}" ${q.id === d.from ? 'selected' : ''}>${esc(q.name)}</option>`).join('')}</optgroup></select></div></div>
      <div class="ime-step"><span>2</span><div class="field"><label>Going to</label>
        <div class="ime-seg">${radio('imeRToM', 'plats', toMode, 'Platforms')}${radio('imeRToM', 'one', toMode, 'One place')}</div>
        ${toMode === 'plats' ? `<div class="two"><div class="field"><label for="imeRPa">From platform</label><select id="imeRPa">${pfOpt(pr[0])}</select></div><div class="field"><label for="imeRPb">To platform</label><select id="imeRPb">${pfOpt(pr[1] || pr[0])}</select></div></div>`
          : `<div class="ime-ps"><input id="imeRToQ" type="search" autocomplete="off" placeholder="Search a place · स्थान खोजें" value="${esc(d.to ? destName(d.to) : '')}"><div class="hero-res ime-res" id="imeRToRes" hidden></div></div>`}</div></div>
      <div class="ime-step"><span>3</span><div class="field"><label>Which way to walk</label>
        ${radio('imeRAp', 'auto', ap, 'Shortest way', 'The app chooses')}${radio('imeRAp', 'pf1', ap, 'Through the platform', 'Platform 1 from the Paharganj side, Platform 16 from the Ajmeri Gate side: enter it first, walk along it')}${radio('imeRAp', 'concourse', ap, 'Along the concourse', 'Stay off the platforms; walk along the concourse')}${radio('imeRAp', 'outside', ap, 'Outside the station building', 'Use the walkways drawn outside (road, footpath, parking); stay out of the concourse and platforms')}</div></div>
      <div class="ime-step"><span>4</span><div class="field"><label>Which foot over bridge</label>
        ${FOBS.length ? `<table class="ime-fobt"><thead><tr><th></th><th>Passengers<br><small>normal</small></th><th>Passengers<br><small>in rush</small></th><th></th></tr></thead><tbody>${FOBS.map((n) => { const w = wOf(n), k = ways.indexOf(w); return `<tr class="${w ? 'on' : ''}"><td><label><input type="checkbox" data-wf="${esc(n)}" ${w ? 'checked' : ''}> ${esc(n.replace(/foot over bridge/i, 'FOB'))}</label></td>
          <td><input type="number" min="0" max="100" step="5" inputmode="numeric" data-ws="${esc(n)}" value="${w && w.share != null ? w.share : ''}" ${w ? '' : 'disabled'} aria-label="${esc(n)} share of passengers">%</td>
          <td><input type="number" min="0" max="100" step="5" inputmode="numeric" data-wr="${esc(n)}" value="${w && w.rushShare != null ? w.rushShare : ''}" ${w ? '' : 'disabled'} aria-label="${esc(n)} share during rush">%</td>
          <td>${w ? `<button class="btn sm${(E.rdWay || 0) === k ? ' primary' : ''}" type="button" data-wshow="${k}">Show</button>` : ''}</td></tr>`; }).join('')}</tbody></table>
        <p class="msg" id="imeRTot"></p>
        <p class="msg">Tick <b>one</b> bridge to send everyone that way. Tick <b>several</b> and give each a share (e.g. FOB 3 80, FOB 1 10, FOB 2 10). <b>In rush</b> is used while any ticked bridge is marked as in rush under Crowd control (e.g. FOB 3 100, the others 0). Unticked bridges are not used for this trip. Tick none: the app picks the bridge.</p>`
          : '<p class="msg">No foot over bridges drawn yet (spaces of type FOB).</p>'}</div></div>
      <details class="ime-more" ${d.via.length ? 'open' : ''}><summary>More: pass through a gate or another point (optional)</summary>
        <div class="field"><label for="imeRStopQr">Pass through a gate / QR board</label><select id="imeRStopQr"><option value="">Choose…</option>${qrs.map((q) => `<option value="${esc(q.id)}">${esc(q.name)}</option>`).join('')}</select></div>
        ${d.via.length ? `<ol class="ime-vlist">${d.via.map((v, i) => `<li>${esc(v.name || (I.levelOf(M(), v.lv) || { name: v.lv }).name + ' (point on the map)')} <button class="btn sm" type="button" data-vup="${i}" ${i ? '' : 'disabled'} title="Earlier">↑</button><button class="btn sm" type="button" data-vdel="${i}">Remove</button></li>`).join('')}</ol>` : ''}
        <div class="actions"><button class="btn sm${E.rdPick ? ' primary' : ''}" type="button" id="imeRPick">${E.rdPick ? '✓ Done tapping points' : '+ Tap points on the map'}</button></div></details>
      <div class="two"><div class="field"><label for="imeRName">Name <small>(optional)</small></label><input id="imeRName" value="${esc(d.name || '')}" placeholder="Automatic, e.g. Via FOB 3"></div><div class="field"><label for="imeRHi">Hindi name <small>(optional)</small></label><input id="imeRHi" value="${esc(d.nameHi || '')}" placeholder="अपने आप, जैसे एफओबी 3 से होकर"></div></div>
      <p class="msg ${E.route ? 'okm' : 'err'}">${esc(E.rdMsg || '')}</p>
      <div class="actions"><button class="btn primary" type="button" id="imeRSave" ${ro || !d.to ? 'disabled' : ''}>Save route</button><button class="btn" type="button" id="imeRCancel">Cancel</button></div>
      <p class="msg">Then tap <b>Save map</b> to send it to passengers.</p>`;
    rdTotals();
  }
  function rdTotals() {
    const el = $('imeRTot'), d = E.rd; if (!el || !d) return; const w = d.ways || [];
    if (w.length < 2) { el.textContent = w.length === 1 ? 'Everyone goes by this bridge.' : ''; el.className = 'msg'; return; }
    const sum = (k) => w.reduce((s, x) => s + (x[k] == null ? 0 : +x[k]), 0), a = sum('share'), b = w.some((x) => x.rushShare != null) ? sum('rushShare') : null;
    el.textContent = `Total: ${a}% normal${b != null ? ` · ${b}% in rush` : ''}${(a && a !== 100) || (b != null && b && b !== 100) ? ' · not 100%: passengers are split in the same proportion' : ''}${!a ? ' · no shares given: passengers get the shortest of these' : ''}`;
    el.className = 'msg' + ((a && a !== 100) || (b != null && b && b !== 100) ? ' err' : ' okm');
  }
  function checks(g, isl) {
    const out = [];
    if (isl.length > 1) isl.slice(1).forEach((ids) => { const n = g.nodes[ids[0]]; out.push({ t: `Walkways on ${levelName(n.lv)} not joined to the rest (${ids.length} points)`, ll: n.ll, lv: n.lv }); });
    { const base = (M().levels.find((l) => (+l.z || 0) === 0) || M().levels[0] || {}).id, plats = M().spaces.filter((s) => s.kind === 'platform' && s.lv === base && s.pts && s.pts.length >= 3).map((s) => ({ s, xy: s.pts.map(g.F.to) }));
      M().paths.filter((p) => p.lv === base).forEach((p) => { const hit = new Set();
        for (let i = 1; i < p.pts.length; i++) { const a = g.F.to(p.pts[i - 1]), b = g.F.to(p.pts[i]), L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 1.5));
          for (let k = 0; k <= n; k++) { const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; plats.forEach((P) => { if (I.inPoly(q, P.xy)) hit.add(P.s.id); }); } }
        if (hit.size >= 3) out.push({ t: `A walkway on ${levelName(base)} crosses ${hit.size} platforms (over the tracks). Is it a bridge drawn on the wrong floor? Routes will walk across the tracks. Select it, then move it to the FOB level or delete it.`, ll: p.pts[Math.floor(p.pts.length / 2)], lv: base, sel: { t: 'path', id: p.id } }); }); }
    ctx.facs().forEach((a) => { const s = I.snap(g, a.lv || 'g', a.ll); if (!s || s.d > 15) out.push({ t: `${a.name}: ${s ? Math.round(s.d) + ' m from' : 'no'} walkway on ${levelName(a.lv || 'g')}`, ll: a.ll, lv: a.lv || 'g', sel: { t: 'fac', id: a.id } }); });
    ctx.qrs().forEach((q) => { const s = I.snap(g, q.lv || 'g', q.ll); if (!s || s.d > 10) out.push({ t: `QR ${q.name}: ${s ? Math.round(s.d) + ' m from' : 'no'} walkway`, ll: q.ll, lv: q.lv || 'g', sel: { t: 'qr', id: q.id } }); });
    M().links.forEach((k) => { const i = g.linkInfo[k.id]; if (!i || i.offA > 6 || i.offB > 6) out.push({ t: `${(I.LINK[k.kind] || {}).label || 'Link'} ${k.name || ''} has an end away from any walkway`, ll: (i && i.offA > 6) || !i ? k.a.ll : k.b.ll, lv: (i && i.offA > 6) || !i ? k.a.lv : k.b.lv, sel: { t: 'link', id: k.id } }); });
    return out;
  }

  // ---------- events ----------
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tool) { E.tool = t.dataset.tool; E.draft = null; if (E.tool !== 'select') { E.sel = null; E.selV = null; } render(); return; }
    if (t.dataset.lv) { E.lv = t.dataset.lv; E.selV = null; render(); return; }
    if (t.dataset.golv) { E.lv = t.dataset.golv; render(); return; }
    if (t.dataset.show != null) { const q = E.issues[+t.dataset.show]; if (q) { E.lv = q.lv; if (q.sel) E.sel = q.sel; render(); lmap.setView(q.ll, Math.max(lmap.getZoom(), 19.5)); } return; }
    if (t.dataset.fdel) { change(() => { M().levels = M().levels.filter((l) => l.id !== t.dataset.fdel); if (E.lv === t.dataset.fdel) E.lv = M().levels[0].id; }); return; }
    switch (t.id) {
      case 'imeFin': finishDraft(); break;
      case 'imeBack': if (E.draft && E.draft.pts) { E.draft.pts.pop(); renderTool(); drawDraft(); } break;
      case 'imeCancel': E.draft = null; render(); break;
      case 'imeDel': change(() => { const s = E.sel; if (s.t === 'space') M().spaces = M().spaces.filter((x) => x.id !== s.id); if (s.t === 'path') M().paths = M().paths.filter((x) => x.id !== s.id); if (s.t === 'link') M().links = M().links.filter((x) => x.id !== s.id); E.sel = null; }); break;
      case 'imeDelV': change(() => { const it = (E.sel.t === 'path' ? M().paths : M().spaces).find((x) => x.id === E.sel.id); const min = E.sel.t === 'path' ? 2 : 3; if (it && it.pts.length > min) it.pts.splice(E.selV, 1); E.selV = null; }); break;
      case 'imeSplit': change(() => { const it = M().paths.find((x) => x.id === E.sel.id), i = E.selV; if (!it || i <= 0 || i >= it.pts.length - 1) return; const b = { id: rid('w'), lv: it.lv, pts: it.pts.slice(i) }; it.pts = it.pts.slice(0, i + 1); M().paths.push(b); E.selV = null; }); break;
      case 'imeExtend': { const it = M().paths.find((x) => x.id === E.sel.id); if (!it) break; E.undo.push(sig()); M().paths = M().paths.filter((x) => x !== it); E.draft = { type: 'walk', pts: it.pts.slice() }; E.tool = 'walk'; E.sel = null; render(); break; }
      case 'imeAddFloor': change(() => { const z = Math.max(...M().levels.map((l) => l.z || 0)) + 1; M().levels.push({ id: rid('l'), name: `Floor ${z}`, hi: '', z }); }); break;
      case 'imeUndo': if (E.undo.length) { E.map = JSON.parse(E.undo.pop()); E.sel = null; E.draft = null; E.route = null; if (!I.levelOf(M(), E.lv)) E.lv = M().levels[0].id; render(); } break;
      case 'imeFill': { const has = M().paths.length + M().spaces.length; if (has && !confirm('Replace the map on screen with one made from the site survey? (Nothing is saved until you tap Save map.)')) break;
        change(() => { const live = M().live; E.map = ctx.prefill(); E.map.live = live; E.lv = 'g'; E.sel = null; }); E.msg = 'Made from the site survey. Check it on the satellite photo, fix the lines, then Save map.'; E.err = false; fit(); render(); break; }
      case 'imeSave': E.busy = true; E.msg = 'Saving…'; E.err = false; renderSave();
        try { await ctx.save(clone(M())); E.saved = sig(); E.msg = M().live ? 'Saved. Passengers now see this map.' : 'Saved, but passengers do NOT see this map yet: tick “Passengers use this map” and save again.'; E.err = !M().live; } catch (err) { E.err = true; E.msg = `Couldn't save: ${(err && err.message) || 'error'}. Try again.`; }
        E.busy = false; renderSave(); break;
      case 'imeTGo': { const q = ctx.qrs().find((x) => x.id === $('imeTF').value), g = E.graph || I.buildGraph(M()), a = E.tt && ctx.targetOf ? ctx.targetOf(E.tt, g) : null; E.tf = q && q.id; E.tsf = $('imeTSF').checked;
        const set = q && E.tt && ctx.testRoute ? ctx.testRoute(q.id, E.tt, g, E.tsf) : null; E.testSet = set ? `Using the route you set: ${set.name}${set.others ? ` (+${set.others} other way${set.others === 1 ? '' : 's'} in the split)` : ''}` : (q && E.tt ? 'No set route for this trip: shortest way shown.' : '');
        E.route = set ? set.route : q && a ? I.route(g, { lv: q.lv || 'g', ll: q.ll }, a, { stepFree: E.tsf }) : null; E.routeMsg = E.route ? '' : !E.tt ? 'Search and choose where to go.' : !a ? 'This place is not on the map yet (no position, or the platform has no platform area drawn).' : 'No route: the walkways are not joined between these two places.'; render();
        if (E.route) lmap.fitBounds(L.latLngBounds(E.route.pts.map((p) => p.ll)).pad(0.2)); break; }
      case 'imeTClr': E.route = null; render(); break;
      case 'imeRNew': E.rd = { id: null, from: E.tf || '*', to: 'plats:2-16', name: '', nameHi: '', via: [], ways: [], approach: 'auto', main: false }; E.rdToMode = 'plats'; E.rdWay = 0; E.rdPick = false; E.route = null; E.rdMsg = ''; $('imeRouteBox').open = true; render(); break;
      case 'imeRPick': E.rdPick = !E.rdPick; if (E.rdPick) { E.tool = 'select'; E.draft = null; E.sel = null; hint('Tap the map where the route must pass.'); } else hint(''); renderRoutes(); break;
      case 'imeRCancel': E.rdToMode = null; E.rd = null; E.rdPick = false; E.route = null; hint(''); render(); break;
      case 'imeRSave': { const d = E.rd; if (!d || !d.to) break; change(() => { M().routes = M().routes || []; const r = { id: d.id || rid('r'), from: d.from, to: d.to, name: (d.name || '').trim(), nameHi: (d.nameHi || '').trim(), via: d.via, main: !!d.main, approach: d.approach || 'auto', ways: (d.ways || []).map((w) => ({ fob: w.fob, share: w.share == null || w.share === '' ? null : Math.max(0, Math.min(100, +w.share)), rushShare: w.rushShare == null || w.rushShare === '' ? null : Math.max(0, Math.min(100, +w.rushShare)) })) };
          if (r.main) M().routes.forEach((x) => { if (x.from === r.from && x.to === r.to) x.main = false; });
          const i = M().routes.findIndex((x) => x.id === r.id); if (i >= 0) M().routes[i] = r; else M().routes.push(r); }); E.rd = null; E.rdPick = false; hint(''); E.msg = 'Route set. Tap Save map to send it to passengers.'; render(); break; }
      default:
        if (t.dataset.rshow || t.dataset.redit) { const r = (M().routes || []).find((x) => x.id === (t.dataset.rshow || t.dataset.redit)); if (!r) break;
          if (t.dataset.redit) { E.rd = clone(r); E.rd.ways = E.rd.ways || []; E.rd.approach = E.rd.approach || 'auto'; E.rdPick = false; E.rdToMode = null; E.rdWay = 0; }
          const keep = E.rd; E.rd = E.rd || clone(r); rdPreview(); if (!t.dataset.redit) E.rd = keep; render(); if (E.route) lmap.fitBounds(L.latLngBounds(E.route.pts.map((p) => p.ll)).pad(0.2)); break; }
        if (t.dataset.rdel) { if (!confirm('Delete this route? Passengers will get the automatic route instead.')) break; change(() => { M().routes = (M().routes || []).filter((x) => x.id !== t.dataset.rdel); }); break; }
        if (t.dataset.wshow != null) { E.rdWay = +t.dataset.wshow; rdPreview(); render(); if (E.route) lmap.fitBounds(L.latLngBounds(E.route.pts.map((p) => p.ll)).pad(0.2)); break; }
        if (t.dataset.vdel != null) { E.rd.via.splice(+t.dataset.vdel, 1); rdPreview(); render(); break; }
        if (t.dataset.vup != null) { const i = +t.dataset.vup; const v = E.rd.via; [v[i - 1], v[i]] = [v[i], v[i - 1]]; rdPreview(); render(); break; }
      case 'imeTakeB': { const b = (ctx.boundary() || [])[0]; if (!b) break; change(() => { const s = { id: rid('s'), lv: (M().levels.find((l) => (l.z || 0) === 0) || M().levels[0]).id, kind: 'stationarea', name: 'Station area', pts: b.map(r7) }; M().spaces.push(s); E.sel = { t: 'space', id: s.id }; E.lv = s.lv; }); break; }
      case 'imeCReset': change(() => { const it = M().spaces.find((x) => x.id === E.sel.id); if (it) { delete it.color; delete it.line; delete it.shade; } }); break;
      case 'imeCAll': change(() => { const it = M().spaces.find((x) => x.id === E.sel.id); if (!it) return; M().spaces.forEach((q) => { if (q.kind !== it.kind || q === it) return; ['color', 'line', 'shade'].forEach((f) => { if (it[f] == null) delete q[f]; else q[f] = it[f]; }); }); }); break;
    }
  });
  root.addEventListener('focusin', (e) => { if (e.target.id === 'imeRToQ' && ctx.searchHtml) { const r = $('imeRToRes'); r.innerHTML = ctx.searchHtml(''); r.hidden = false; try { e.target.select(); } catch { /* ignore */ } return; } if (e.target.id === 'imeTQ' && ctx.searchHtml) { const r = $('imeTRes'); r.innerHTML = ctx.searchHtml(''); r.hidden = false; try { e.target.select(); r.scrollIntoView({ block: 'nearest' }); } catch { /* ignore */ } } });
  root.addEventListener('keydown', (e) => { if (e.target.id !== 'imeTQ') return; if (e.key === 'Escape') $('imeTRes').hidden = true; if (e.key === 'Enter') { e.preventDefault(); const f = $('imeTRes').querySelector('[data-hid]'); if (f) f.click(); } });
  root.addEventListener('click', (e) => { const b2 = e.target.closest('#imeRToRes [data-hid]'); if (b2 && E.rd) { e.stopPropagation(); E.rd.to = b2.dataset.hid; $('imeRToRes').hidden = true; rdPreview(); render(); return; } const b = e.target.closest('#imeTRes [data-hid]'); if (b) { E.tt = b.dataset.hid; $('imeTRes').hidden = true; e.stopPropagation(); setTimeout(() => { const go = $('imeTGo'); if (go) go.click(); }, 0); return; } if (!e.target.closest('.ime-ps')) { if ($('imeTRes')) $('imeTRes').hidden = true; if ($('imeRToRes')) $('imeRToRes').hidden = true; } }, true);
  root.addEventListener('change', (e) => {
    const t = e.target, s = E.sel;
    if (t.id === 'imeKind') E.kind = t.value;
    else if (t.id === 'imeLKind') E.linkKind = t.value;
    else if (t.id === 'imeLive') change(() => { M().live = t.checked; });
    else if (t.id === 'imeSKind') change(() => { M().spaces.find((x) => x.id === s.id).kind = t.value; });
    else if (t.id === 'imeLK') change(() => { M().links.find((x) => x.id === s.id).kind = t.value; });
    else if (t.id === 'imeLDir') change(() => { const k = M().links.find((x) => x.id === s.id); if (k) { if (t.value) k.dir = t.value; else delete k.dir; } });
    else if (t.id === 'imeWLv') { change(() => { const p = M().paths.find((x) => x.id === s.id); if (p) p.lv = t.value; }); E.lv = t.value; render(); }
    else if (t.id === 'imeWDir') change(() => { const p = M().paths.find((x) => x.id === s.id); if (p) { if (t.value) p.dir = t.value; else delete p.dir; } });
    else if (t.id === 'imeCFill' || t.id === 'imeCLine') change(() => { const it = M().spaces.find((x) => x.id === s.id); if (!it) return; if (t.id === 'imeCLine' || I.OUTLINE(it.kind)) it.line = t.value; else it.color = t.value; });
    else if (t.id === 'imeCShade') change(() => { const it = M().spaces.find((x) => x.id === s.id); if (it) it.shade = +t.value; });
    else if (t.dataset.eshow) { SHOW[t.dataset.eshow] = t.checked; try { localStorage.setItem('wf-ed-show', JSON.stringify(SHOW)); } catch { /* ignore */ } render(); }
    else if (t.dataset.plbl) change(() => { M().labels = Object.assign({}, ctx.labelDefaults || {}, M().labels || {}); M().labels[t.dataset.plbl] = t.checked; });
    else if (t.id === 'imeGWalk') change(() => { M().style = Object.assign({ bg: 0.32, shade: 0.5 }, M().style || {}); M().style.walk = t.value; });
    else if (t.id === 'imeGShade' || t.id === 'imeGBg') change(() => { M().style = Object.assign({ bg: 0.32, shade: 0.5 }, M().style || {}); M().style[t.id === 'imeGShade' ? 'shade' : 'bg'] = +t.value; });
    else if (t.id === 'imeRFrom' || t.id === 'imeRTo') { E.rd[t.id === 'imeRFrom' ? 'from' : 'to'] = t.value; rdPreview(); render(); }
    else if (t.id === 'imeRPa' || t.id === 'imeRPb') { let a = +$('imeRPa').value, b = +$('imeRPb').value; if (a > b) [a, b] = [b, a]; E.rd.to = `plats:${a}-${b}`; rdPreview(); render(); }
    else if (t.id === 'imeRStopQr' && t.value) { const q = (ctx.qrs() || []).find((x) => x.id === t.value); if (q) { E.rd.via.push({ lv: q.lv || 'g', ll: q.ll, name: q.name }); rdPreview(); render(); } }
    else if (t.name === 'imeRToM') { E.rdToMode = t.value; E.rd.to = t.value === 'plats' ? 'plats:2-16' : ''; rdPreview(); render(); }
    else if (t.name === 'imeRAp') { E.rd.approach = t.value; rdPreview(); render(); }
    else if (t.dataset.wf) { const n = t.dataset.wf, F = ctx.fobNames ? ctx.fobNames() : []; let w = (E.rd.ways || []).filter((x) => x.fob !== n); if (t.checked) w.push({ fob: n, share: null, rushShare: null }); w.sort((a, b) => F.indexOf(a.fob) - F.indexOf(b.fob)); E.rd.ways = w; E.rdWay = Math.max(0, w.findIndex((x) => x.fob === n)); rdPreview(); render(); }
    else if (t.id === 'imeRMain') E.rd.main = t.checked;
    else if (t.id === 'imeGUse') { if (ctx.setGateUse) ctx.setGateUse(s.id, t.value); }
    else if (t.id === 'imeGPax') { if (ctx.setGatePax) ctx.setGatePax(s.id, t.value); }
    else if (t.id === 'imeOLv') { if (s.t === 'fac') ctx.setFac(s.id, { lv: t.value }); else ctx.setQr(s.id, { lv: t.value }); }
    else if (t.dataset.fl) change(() => { const l = I.levelOf(M(), t.dataset.fl); if (!l) return; l[t.dataset.fk] = t.dataset.fk === 'z' ? +t.value || 0 : t.value; });
  });
  root.addEventListener('input', (e) => {
    const t = e.target, s = E.sel;
    if ((t.dataset.ws || t.dataset.wr) && E.rd) { const w = (E.rd.ways || []).find((x) => x.fob === (t.dataset.ws || t.dataset.wr)); if (w) w[t.dataset.ws ? 'share' : 'rushShare'] = t.value === '' ? null : +t.value; rdTotals(); return; }
    if (t.id === 'imeRToQ' && ctx.searchHtml) { const r = $('imeRToRes'); r.innerHTML = ctx.searchHtml(t.value); r.hidden = false; return; }
    if (t.id === 'imeTQ' && ctx.searchHtml) { const r = $('imeTRes'); r.innerHTML = ctx.searchHtml(t.value); r.hidden = false; return; }
    if (t.id === 'imeDName' && E.draft) E.draft.name = t.value;
    if (t.id === 'imeSName' || t.id === 'imeSHi') { const it = M().spaces.find((x) => x.id === s.id); if (it) { if (!t.__u) { E.undo.push(sig()); t.__u = 1; } it[t.id === 'imeSName' ? 'name' : 'nameHi'] = t.value; renderSaveSoon(); } }
    if ((t.id === 'imeRName' || t.id === 'imeRHi') && E.rd) E.rd[t.id === 'imeRName' ? 'name' : 'nameHi'] = t.value;
    if ((t.id === 'imeRShare' || t.id === 'imeRRush') && E.rd) E.rd[t.id === 'imeRShare' ? 'share' : 'rushShare'] = t.value === '' ? null : +t.value;
    if (t.id === 'imeLN') { const k = M().links.find((x) => x.id === s.id); if (k) { k.name = t.value; renderSaveSoon(); } }
  });
  let saveT = null; const renderSaveSoon = () => { clearTimeout(saveT); saveT = setTimeout(renderSave, 300); };
  document.addEventListener('keydown', (e) => { if (!root.isConnected || root.offsetParent === null) return; if (e.key === 'Enter' && E.draft && E.draft.pts && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) finishDraft(); if (e.key === 'Escape' && E.draft) { E.draft = null; render(); } });

  function fit() { const pts = [].concat(...M().paths.map((p) => p.pts), ...M().spaces.map((s) => s.pts)); const b = ctx.boundary() && ctx.boundary()[0]; const all = pts.length ? pts : b || []; if (all.length > 1) lmap.fitBounds(L.latLngBounds(all).pad(0.05)); }
  return {
    load(map) { const keepView = !!E.map; E.map = map ? clone(map) : I.emptyMap(); if (!E.map.levels || !E.map.levels.length) E.map.levels = I.emptyMap().levels; ['spaces', 'paths', 'links', 'routes'].forEach((k) => (E.map[k] = E.map[k] || [])); E.map.style = Object.assign({ bg: 0.32, shade: 0.5 }, E.map.style || {}); E.saved = sig(); if (!I.levelOf(E.map, E.lv)) E.lv = E.map.levels[0].id; render(); if (!keepView) fit(); },
    isDirty: dirty,
    refresh() { render(); },
    resize() { lmap.invalidateSize(); },
  };
}
