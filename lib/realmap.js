// Real (GPS) map of the station.
// Everything is drawn at its surveyed position, with true lengths and shapes:
// platforms (from their two recorded ends), foot over bridges (from their bridge points), gates, entries,
// pillars, amenities, construction areas and the area outside the station (parking, roads, drop-off…).
// Used by the staff Station layout ("Real map") and by the passengers' "Live map".

export const OUT_KINDS = [
  // id, label, default shape, colour, short code
  ['station', 'Station area boundary (black line)', 'area', '#111111', ''],
  ['stationbldg', 'Station building layout (white line)', 'area', '#FFFFFF', ''],
  ['parking', 'Parking area', 'area', '#2F6FDE', 'P'],
  ['road', 'Road', 'line', '#59616B', ''],
  ['dropoff', 'Drop-off / pick-up zone', 'area', '#E08A12', '⇣'],
  ['circ', 'Forecourt / circulating area', 'area', '#8E9AA6', ''],
  ['taxi', 'Taxi / auto stand', 'point', '#D9A400', 'T'],
  ['bus', 'Bus stop', 'point', '#1E8E5A', 'B'],
  ['metro', 'Metro entrance', 'point', '#7B3FB8', 'M'],
  ['building', 'Building', 'area', '#8C6E4F', ''],
  ['construction', 'Construction / redevelopment site', 'area', '#E8731A', '⚠'],
  ['other', 'Other place outside', 'point', '#475569', '•'],
];
export const OUT = Object.fromEntries(OUT_KINDS.map(k => [k[0], { id: k[0], label: k[1], shape: k[2], color: k[3], code: k[4] }]));

const R = 6371008.8;
const rad = d => d * Math.PI / 180;
// metres between two [lat,lng]
export function metres(a, b) {
  const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
export const pathLength = pts => pts.reduce((s, p, i) => i ? s + metres(pts[i - 1], p) : 0, 0);
// local flat frame (metres east, north) around a reference point
function frame(ref) {
  const kx = 111320 * Math.cos(rad(ref[0])), ky = 110540;
  return {
    to: p => [(p[1] - ref[1]) * kx, (p[0] - ref[0]) * ky],
    from: q => [ref[0] + q[1] / ky, ref[1] + q[0] / kx],
  };
}
// a band of the given width (metres) along a line a→b, as a polygon
export function band(a, b, w) {
  const F = frame(a), A = F.to(a), B = F.to(b), dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * w / 2, ny = dx / L * w / 2;
  return [[A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], [A[0] - nx, A[1] - ny]].map(F.from);
}
// screen angle (deg) of a line, kept upright for labels
function labelAngle(a, b) {
  const F = frame(a), B = F.to(b);
  let d = -Math.atan2(B[1], B[0]) * 180 / Math.PI;
  if (d > 90) d -= 180; if (d < -90) d += 180;
  return Math.round(d);
}
// nearest point on a polyline: { d: distance along (m), off: distance away (m), i: segment index }
export function project(line, p) {
  if (!line.length) return null;
  const F = frame(p), Q = line.map(F.to);
  let best = null, run = 0;
  for (let i = 1; i < Q.length; i++) {
    const a = Q[i - 1], b = Q[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
    const t = L2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)) : 0;
    const x = a[0] + dx * t, y = a[1] + dy * t, off = Math.hypot(x, y);
    if (!best || off < best.off) best = { d: run + L * t, off, i: i - 1, ll: F.from([x, y]) };
    run += L;
  }
  if (Q.length === 1) best = { d: 0, off: Math.hypot(Q[0][0], Q[0][1]), i: 0, ll: line[0] };
  return best;
}

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const has = p => p && typeof p.lat === 'number' && typeof p.lng === 'number';
const fmtM = m => m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m';

// ---------- model from the survey ----------
// survey: { id: point }, helpers: { pfBar, platLabel, gateText, endName, staff }
export function buildModel(survey, h) {
  const pts = Object.entries(survey || {}).map(([id, p]) => Object.assign({ id }, p)).filter(has);
  const out = { platforms: [], bridges: [], gates: [], entries: [], pillars: [], works: [], outside: [], bounds: pts.map(p => [p.lat, p.lng]) };
  // platforms
  const byBar = {};
  pts.filter(p => p.t === 'pfend' || p.t === 'pillar' || p.t === 'pfpt').forEach(p => { const b = h.pfBar(+p.pf); (byBar[b] = byBar[b] || { ends: {}, pillars: [], bends: [] }); if (p.t === 'pfend') byBar[b].ends[p.end] = p; else if (p.t === 'pfpt') byBar[b].bends.push(p); else byBar[b].pillars.push(p); });
  Object.entries(byBar).forEach(([b, g]) => {
    b = +b; const e1 = g.ends.sdb, e2 = g.ends.nzm; let a = null, z = null, measured = false;
    if (e1 && e2) { a = [e1.lat, e1.lng]; z = [e2.lat, e2.lng]; measured = true; }
    else {
      const all = [...Object.values(g.ends), ...g.pillars].map(p => [p.lat, p.lng]);
      let dm = 0; all.forEach(p => all.forEach(q => { const d = metres(p, q); if (d > dm) { dm = d; a = p; z = q; } }));
    }
    g.pillars.forEach(p => out.pillars.push({ bar: b, n: String(p.pillar || '?'), ll: [p.lat, p.lng] }));
    if (!a || !z || metres(a, z) < 5) return;
    // bend points recorded along the platform, in order from a to z
    const F = frame(a), Z = F.to(z), L2 = Z[0] * Z[0] + Z[1] * Z[1] || 1;
    const bends = g.bends.map(p => [p.lat, p.lng]).map(q => ({ q, t: (F.to(q)[0] * Z[0] + F.to(q)[1] * Z[1]) / L2 })).filter(x => x.t > 0 && x.t < 1).sort((x, y) => x.t - y.t).map(x => x.q);
    const line = [a, ...bends, z];
    out.platforms.push({ bar: b, name: h.platLabel(b), island: b >= 1 && b <= 7, a, z, line, bends: bends.length, measured, length: pathLength(line),
      endA: e1 ? h.endName('sdb') : '', endZ: e2 ? h.endName('nzm') : '', pillars: g.pillars.length });
  });
  out.platforms.sort((x, y) => x.bar - y.bar);
  // bridges
  const byBr = {};
  pts.filter(p => p.t === 'fob').forEach(p => { const k = String(p.bridge || 'Foot over bridge').trim(); (byBr[k] = byBr[k] || []).push(p); });
  Object.entries(byBr).forEach(([name, arr]) => {
    arr.sort((x, y) => (+x.seq || 0) - (+y.seq || 0));
    const segs = [], seen = new Set();
    const add = (p, q, dashed) => { if (!q || !has(q)) return; const k = [p.id, q.id].sort().join('|'); if (seen.has(k)) return; seen.add(k); segs.push({ a: [q.lat, q.lng], b: [p.lat, p.lng], dashed }); };
    arr.forEach((p, i) => {
      const par = p.from && survey[p.from] ? Object.assign({ id: p.from }, survey[p.from]) : i > 0 ? arr[i - 1] : null;
      if (par) add(p, par, false);
      (Array.isArray(p.links) ? p.links : []).forEach(t => survey[t] && add(p, Object.assign({ id: t }, survey[t]), true));
    });
    const ways = [];
    arr.forEach(p => (Array.isArray(p.ways) ? p.ways : p.to ? [{ to: p.to, pf: p.pf, gate: p.gate, stairs: p.stairs, lift: p.lift, esc: p.esc }] : [])
      .forEach(w => ways.push({ ll: [p.lat, p.lng], w, seq: p.seq })));
    out.bridges.push({ name, segs, ways, points: arr.length, length: segs.reduce((s, x) => s + metres(x.a, x.b), 0) });
  });
  out.bridges.sort((x, y) => x.name.localeCompare(y.name, undefined, { numeric: true }));
  pts.filter(p => p.t === 'gate').forEach(p => out.gates.push({ ll: [p.lat, p.lng], name: h.gateText(p.n), status: p.status || 'open', side: p.side }));
  pts.filter(p => p.t === 'entry').forEach(p => out.entries.push({ ll: [p.lat, p.lng], name: p.name || 'Station entry', status: p.status || 'open', side: p.side }));
  pts.filter(p => p.t === 'work').forEach(p => out.works.push({ ll: [p.lat, p.lng], color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '', name: p.name || 'Construction work', r: +p.r || 20, block: !!p.block, show: p.show !== false, until: p.until || '' }));
  pts.filter(p => p.t === 'out').forEach(p => {
    const k = OUT[p.kind] || OUT.other, shape = p.shape || k.shape;
    const line = (Array.isArray(p.pts) ? p.pts : []).filter(q => Array.isArray(q) && q.length === 2);
    out.outside.push({ id: p.id, kind: k.id, label: k.label, color: /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : k.color, code: k.code, name: p.name || k.label, shape, ll: [p.lat, p.lng], pts: line, note: p.note || '',
      length: shape === 'line' ? pathLength(line) : 0, area: shape === 'area' ? polyArea(line) : 0 });
    line.forEach(q => out.bounds.push(q));
  });
  // station building outline: drawn by staff (kind "station"), otherwise worked out from the survey by the app
  if (!out.outside.some((o) => o.kind === 'station') && Array.isArray(h.boundary) && h.boundary.length >= 3)
    out.outside.unshift({ id: '', kind: 'station', label: OUT.station.label, color: OUT.station.color, code: '', name: 'Station building', shape: 'area', ll: h.boundary[0], pts: h.boundary, note: 'Outline worked out from the site survey. Staff can draw the exact one in the Site survey (Outside the station → Station building).', length: 0, area: polyArea(h.boundary), auto: true });
  out.walks = Array.isArray(h.walks) ? h.walks : [];
  return out;
}
export function polyArea(pts) {
  if (pts.length < 3) return 0; const F = frame(pts[0]), Q = pts.map(F.to); let s = 0;
  for (let i = 0; i < Q.length; i++) { const a = Q[i], b = Q[(i + 1) % Q.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

// ---------- drawing ----------
const STATUS_COL = { open: '#18212B', entry: '#127A4B', exit: '#B4232A', closed: '#8A94A0' };
const STATUS_TXT = { open: 'Entry & exit', entry: 'Entry only', exit: 'Exit only', closed: 'Closed' };
function pill(L, ll, text, cls, title) {
  return L.marker(ll, { icon: L.divIcon({ className: 'rm-pill ' + (cls || ''), html: `<span>${esc(text)}</span>`, iconSize: null }), title: title || text, keyboard: false });
}
function label(L, ll, html, cls, angle) {
  return L.marker(ll, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'rm-lab ' + (cls || ''), html: `<span style="transform:translate(-50%,-50%) rotate(${angle || 0}deg)">${html}</span>`, iconSize: [0, 0] }) });
}
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

// Draws the model into one Leaflet layer group per kind. opts: { staff, facilities:[{ll,code,name,open,where}], onPick(info) }
export function drawModel(L, model, opts = {}) {
  const G = {
    outside: L.layerGroup(), platforms: L.layerGroup(), bridges: L.layerGroup(), gates: L.layerGroup(),
    pillars: L.layerGroup(), amenities: L.layerGroup(), works: L.layerGroup(), labels: L.layerGroup(),
  };
  const pick = (layer, info) => { layer.on('click', e => { if (opts.onPick) opts.onPick(info, e.latlng); }); return layer; };
  // outside the station (drawn first, underneath)
  model.outside.forEach(o => {
    const info = { type: 'outside', title: o.name, rows: [['Type', o.label], o.shape === 'line' ? ['Length', fmtM(o.length)] : o.shape === 'area' ? ['Area', Math.round(o.area).toLocaleString('en-IN') + ' m²'] : null, o.note ? ['Note', o.note] : null].filter(Boolean), id: o.id };
    if (o.kind === 'station' && o.pts.length >= 3) {   // station area: black line
      pick(L.polygon(o.pts, { color: '#111111', weight: 3.5, fillColor: '#FFFFFF', fillOpacity: .22, className: 'rm-station' }), info).addTo(G.outside);
      return;
    }
    if (o.kind === 'stationbldg' && o.pts.length >= 3) {   // station building: white line with a thin grey edge so it shows on any map
      L.polygon(o.pts, { color: '#5F6368', weight: 7, fill: false, interactive: false }).addTo(G.outside);
      pick(L.polygon(o.pts, { color: '#FFFFFF', weight: 4, fillColor: '#FFFFFF', fillOpacity: .55, className: 'rm-bldg' }), info).addTo(G.outside);
      return;
    }
    if (o.shape === 'area' && o.pts.length >= 3) {
      pick(L.polygon(o.pts, { color: o.color, weight: 2, fillColor: o.color, fillOpacity: .22, className: 'rm-out' }), info).addTo(G.outside);
      const c = o.pts.reduce((s, p) => [s[0] + p[0] / o.pts.length, s[1] + p[1] / o.pts.length], [0, 0]);
      label(L, c, `${o.code ? `<b class="rm-code" style="background:${o.color}">${esc(o.code)}</b>` : ''}${esc(o.name)}`, 'rm-outlab').addTo(G.labels);
    } else if (o.shape === 'line' && o.pts.length >= 2) {
      pick(L.polyline(o.pts, { color: '#ffffff', weight: 11, opacity: .9, className: 'rm-road-case' }), info).addTo(G.outside);
      pick(L.polyline(o.pts, { color: o.color, weight: 7, opacity: .95 }), info).addTo(G.outside);
      let best = 0, bi = 1; for (let i = 1; i < o.pts.length; i++) { const d = metres(o.pts[i - 1], o.pts[i]); if (d > best) { best = d; bi = i; } }
      label(L, mid(o.pts[bi - 1], o.pts[bi]), esc(o.name), 'rm-roadlab', labelAngle(o.pts[bi - 1], o.pts[bi])).addTo(G.labels);
    } else {
      pick(L.marker(o.ll, { icon: L.divIcon({ className: 'rm-poi', html: `<b style="background:${o.color}">${esc(o.code || '•')}</b><span>${esc(o.name)}</span>`, iconSize: null }), title: o.name }), info).addTo(G.outside);
    }
  });
  // platforms
  // walking paths of the station (blue network, like an indoor map)
  (model.walks || []).forEach((w) => L.polyline(w, { color: '#4A8BE8', weight: 2.5, opacity: .75, interactive: false }).addTo(G.bridges));
  model.platforms.forEach(p => {
    const w = p.island ? 11 : 8;
    const rows = [['Kind', p.island ? 'Island platform (two tracks)' : 'Side platform (one track)'], ['Length', fmtM(p.length) + (p.measured ? '' : ' (estimated: one end missing)')], ['Bend points', String(p.bends || 0)], ['Pillars recorded', String(p.pillars)]];
    if (opts.staff) { if (p.endA) rows.push(['Start', `${p.endA} · ${p.a[0].toFixed(6)}, ${p.a[1].toFixed(6)}`]); if (p.endZ) rows.push(['End', `${p.endZ} · ${p.z[0].toFixed(6)}, ${p.z[1].toFixed(6)}`]); }
    const info = { type: 'platform', title: p.name, rows };
    const ln = p.line || [p.a, p.z];
    for (let i = 1; i < ln.length; i++) pick(L.polygon(band(ln[i - 1], ln[i], w), { color: '#C9A227', weight: ln.length > 2 ? 1 : 2, fillColor: '#F2EEE3', fillOpacity: .92, className: 'rm-plat' + (p.measured ? '' : ' est') }), info).addTo(G.platforms);
    for (let i = 1; i < ln.length - 1; i++) L.circle(ln[i], { radius: w / 2, color: '#F2EEE3', weight: 0, fillColor: '#F2EEE3', fillOpacity: .92, interactive: false }).addTo(G.platforms);
    L.polyline(ln, { color: '#C9A227', weight: 1, opacity: .7, dashArray: '2 8', interactive: false }).addTo(G.platforms);
    [p.a, p.z].forEach(e => L.circleMarker(e, { radius: 3.5, color: '#8a6d00', weight: 1.5, fillColor: '#F3C531', fillOpacity: 1, interactive: false }).addTo(G.platforms));
    let bi = 1, bl = 0; for (let i = 1; i < ln.length; i++) { const d = metres(ln[i - 1], ln[i]); if (d > bl) { bl = d; bi = i; } }
    label(L, mid(ln[bi - 1], ln[bi]), `<b>${esc(p.name.replace('Platform ', 'PF '))}</b><i>${fmtM(p.length)}</i>`, 'rm-platlab', labelAngle(ln[bi - 1], ln[bi])).addTo(G.labels);
  });
  // pillars
  model.pillars.forEach(q => {
    L.circleMarker(q.ll, { radius: 3, color: '#5b5b5b', weight: 1, fillColor: '#fff', fillOpacity: 1 }).bindTooltip('Pillar ' + q.n, { direction: 'top' }).addTo(G.pillars);
    label(L, q.ll, esc(q.n), 'rm-pillab').addTo(G.pillars);
  });
  // foot over bridges
  model.bridges.forEach(b => {
    const info = { type: 'bridge', title: b.name, rows: [['Length on the bridge', fmtM(b.length)], ['Points recorded', String(b.points)], ['Ways up and down', String(b.ways.length)]] };
    b.segs.forEach(s => {
      pick(L.polygon(band(s.a, s.b, 6), { color: '#1D59C4', weight: 1.5, fillColor: '#3D7BE0', fillOpacity: s.dashed ? .35 : .55, className: 'rm-fob' }), info).addTo(G.bridges);
    });
    let best = null; b.segs.forEach(s => { const d = metres(s.a, s.b); if (!best || d > best.d) best = { d, s }; });
    if (best) label(L, mid(best.s.a, best.s.b), `<b>${esc(b.name.replace(/Foot Over Bridge/i, 'FOB'))}</b><i>${fmtM(b.length)}</i>`, 'rm-foblab', labelAngle(best.s.a, best.s.b)).addTo(G.labels);
    b.ways.forEach(({ ll, w }) => {
      const k = [w.lift && 'Lift', w.esc && 'Escalator', (w.stairs || (!w.lift && !w.esc)) && 'Stairs'].filter(Boolean);
      const code = w.lift ? '⇅' : w.esc ? '↗' : '≡';
      const to = w.to === 'pf' ? 'platform' : w.to === 'P' ? 'Paharganj side' : w.to === 'A' ? 'Ajmeri Gate side' : w.to === 'gate' ? (w.gate || 'gate') : 'down';
      L.marker(ll, { icon: L.divIcon({ className: 'rm-way', html: `<b>${code}</b>`, iconSize: null }), title: `${k.join(' + ')} to ${to}` })
        .bindTooltip(`${k.join(' + ')} · to ${esc(to)}`, { direction: 'top' }).addTo(G.bridges);
    });
  });
  // gates and entries
  model.gates.forEach(g => pick(pill(L, g.ll, g.name, 'gate st-' + g.status, `${g.name} · ${STATUS_TXT[g.status] || ''}`), { type: 'gate', title: g.name, rows: [['Use', STATUS_TXT[g.status] || 'Entry & exit']] }).addTo(G.gates));
  model.entries.forEach(g => pick(pill(L, g.ll, g.name, 'entry st-' + g.status, `${g.name} · ${STATUS_TXT[g.status] || ''}`), { type: 'entry', title: g.name, rows: [['Use', STATUS_TXT[g.status] || 'Entry & exit']] }).addTo(G.gates));
  // amenities
  (opts.facilities || []).forEach(a => {
    pick(L.marker(a.ll, { icon: L.divIcon({ className: 'rm-am' + (a.open ? '' : ' off') + (a.dest ? ' dest' : '') + (a.cls ? ' ' + a.cls : ''), html: a.html || `<b>${esc(a.code || '•')}</b>`, iconSize: null }), title: a.name, zIndexOffset: a.dest ? 1200 : a.cls && / on/.test(' ' + a.cls) ? 600 : 0 }),
      { type: 'amenity', title: a.name, rows: [a.count ? ['How many', a.count] : null, a.where ? ['Where', a.where] : null, a.open ? null : ['Status', 'Closed now']].filter(Boolean), id: a.id }).addTo(G.amenities);
  });
  // construction
  model.works.filter(w => w.show || opts.staff).forEach(w => {
    pick(L.circle(w.ll, { radius: w.r, color: w.color || '#C2410C', weight: 2, dashArray: '6 5', fillColor: w.color || '#F97316', fillOpacity: w.block ? .3 : .15 }),
      { type: 'work', title: '⚠ ' + w.name, rows: [['Passage', w.block ? 'Closed: routes go around it' : 'Open with care'], w.until ? ['Until', w.until] : null].filter(Boolean) }).addTo(G.works);
  });
  return G;
}

export function measurementsHtml(model) {
  const pr = model.platforms.map(p => `<tr><td>${esc(p.name)}</td><td>${p.island ? 'Island' : 'Side'}</td><td class="n">${fmtM(p.length)}${p.measured ? '' : ' <small>est.</small>'}</td><td class="n">${p.pillars}</td></tr>`).join('');
  const br = model.bridges.map(b => `<tr><td>${esc(b.name)}</td><td class="n">${fmtM(b.length)}</td><td class="n">${b.points}</td><td class="n">${b.ways.length}</td></tr>`).join('');
  const ot = model.outside.map(o => `<tr><td>${esc(o.name)}</td><td>${esc(o.label)}</td><td class="n">${o.shape === 'line' ? fmtM(o.length) : o.shape === 'area' ? Math.round(o.area).toLocaleString('en-IN') + ' m²' : '—'}</td></tr>`).join('');
  return `<div class="rm-tables">
    <div><h4>Platforms</h4>${pr ? `<table class="rm-t"><thead><tr><th>Platform</th><th>Kind</th><th class="n">Length</th><th class="n">Pillars</th></tr></thead><tbody>${pr}</tbody></table>` : '<p class="msg">No platform ends recorded yet.</p>'}</div>
    <div><h4>Foot over bridges</h4>${br ? `<table class="rm-t"><thead><tr><th>Bridge</th><th class="n">Length</th><th class="n">Points</th><th class="n">Ways down</th></tr></thead><tbody>${br}</tbody></table>` : '<p class="msg">No bridge points recorded yet.</p>'}</div>
    <div><h4>Outside the station</h4>${ot ? `<table class="rm-t"><thead><tr><th>Name</th><th>Type</th><th class="n">Size</th></tr></thead><tbody>${ot}</tbody></table>` : '<p class="msg">Nothing recorded yet. Use <b>Site survey → Outside the station</b> for parking, roads, drop-off and taxi stands.</p>'}</div>
  </div>`;
}

// base map layers: satellite, street, plain
export function baseLayers(L) {
  return {
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 19, maxZoom: 21, attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' }),
    'Street map': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxNativeZoom: 19, maxZoom: 21, attribution: '&copy; OpenStreetMap contributors' }),
    'Plain plan': L.layerGroup(),
  };
}
