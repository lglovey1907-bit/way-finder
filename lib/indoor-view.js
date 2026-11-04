// Passenger 3D map of the drawn station (Mappedin-style): raised spaces per floor, a floor switcher,
// amenity icons, "You are here", and the route as a ribbon that climbs to the bridges.
// createIndoorView(el, { onPick(id), onReady }) → { set({map, facs, here, dest, route, boundary}), level(id), fit(), destroy() }
import * as I from './indoor';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BASE = { version: 8, sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#EEF0F3' } }, { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.32, 'raster-saturation': -0.6 } }] };

export function createIndoorView(el, opts = {}) {
  el.classList.add('ivm');
  el.innerHTML = '<div class="ivm-map"></div><div class="ivm-floors" role="group" aria-label="Floor · मंज़िल"></div><div class="ivm-load">Loading map…</div>';
  const box = el.querySelector('.ivm-map'), floorsEl = el.querySelector('.ivm-floors');
  const V = { ml: null, map: null, data: null, lv: null, markers: [], ready: false, fitted: false, userLv: false };

  import('maplibre-gl').then((mod) => {
    const ml = (V.ml = mod.default || mod);
    V.map = new ml.Map({ container: box, style: BASE, center: [77.2195, 28.6425], zoom: 16.5, pitch: 45, maxPitch: 70, maxZoom: 21.5, attributionControl: { compact: true }, dragRotate: true });
    V.map.addControl(new ml.NavigationControl({ visualizePitch: true, showCompass: true }), 'top-left');
    const zc = () => el.classList.toggle('z18', V.map.getZoom() >= 18.4); V.map.on('zoom', zc);
    V.map.on('load', () => { zc(); V.ready = true; el.querySelector('.ivm-load').hidden = true; draw(); if (opts.onReady) opts.onReady(); });
  }).catch(() => { el.querySelector('.ivm-load').textContent = "The map couldn't load. Check the internet connection."; });

  const levels = () => (V.data && V.data.map ? V.data.map.levels.slice().sort((a, b) => (a.z || 0) - (b.z || 0)) : []);
  const baseH = (lv) => { const L = V.data && I.levelOf(V.data.map, lv); return (L ? L.z || 0 : 0) * I.LEVEL_H; };
  const fc = (f) => ({ type: 'FeatureCollection', features: f });
  const ringOf = (pts) => [[...pts, pts[0]].map((p) => [p[1], p[0]])];
  function src(id, data) { const s = V.map.getSource(id); if (s) s.setData(data); else V.map.addSource(id, { type: 'geojson', data }); }
  function layer(L, before) { if (!V.map.getLayer(L.id)) V.map.addLayer(L, before); }

  function draw() {
    if (!V.ready || !V.data) return; const D = V.data, M = D.map, F = I.frame(I.origin(M));
    if (!V.lv || !I.levelOf(M, V.lv)) V.lv = (D.here && D.here.lv) || (levels()[0] || {}).id;
    // station area outline
    const SA = M.spaces.filter((s) => s.kind === 'stationarea' && s.pts.length >= 3), saLine = SA.length ? I.styleOf(SA[0], M.style).line : '#111111';
    if (V.map.getLayer('osm')) V.map.setPaintProperty('osm', 'raster-opacity', M.style && M.style.bg != null ? +M.style.bg : 0.32);
    src('iv-bnd', fc((SA.length ? SA.map((s) => s.pts) : D.boundary || []).map((b) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: ringOf(b) } }))));
    layer({ id: 'iv-bnd-f', type: 'fill', source: 'iv-bnd', paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.45 } });
    layer({ id: 'iv-bnd-l', type: 'line', source: 'iv-bnd', paint: { 'line-color': '#111111', 'line-width': 2.5 } }); V.map.setPaintProperty('iv-bnd-l', 'line-color', saLine);
    // building outline(s)
    src('iv-bld', fc(M.spaces.filter((s) => s.kind === 'building' && s.pts.length >= 3).map((s) => ({ type: 'Feature', properties: { l: I.styleOf(s, M.style).line }, geometry: { type: 'Polygon', coordinates: ringOf(s.pts) } }))));
    layer({ id: 'iv-bld-f', type: 'fill', source: 'iv-bld', paint: { 'fill-color': '#FFFFFF', 'fill-opacity': 0.7 } });
    layer({ id: 'iv-bld-c', type: 'line', source: 'iv-bld', paint: { 'line-color': '#80868B', 'line-width': 5 } });
    layer({ id: 'iv-bld-l', type: 'line', source: 'iv-bld', paint: { 'line-color': ['get', 'l'], 'line-width': 2.5 } });
    // spaces, one layer per floor so the floor in view stands out
    levels().forEach((L) => {
      const b = (L.z || 0) * I.LEVEL_H, feats = M.spaces.filter((s) => s.lv === L.id && !I.OUTLINE(s.kind) && s.pts.length >= 3).map((s) => { const k = I.KIND[s.kind] || I.KIND.other, st = I.styleOf(s, M.style);
        return { type: 'Feature', properties: { c: st.fill, l: st.line, b, h: b + Math.max(0.05, k.h), id: s.id }, geometry: { type: 'Polygon', coordinates: ringOf(s.pts) } }; });
      src('iv-sp-' + L.id, fc(feats));
      layer({ id: 'iv-sp-' + L.id, type: 'fill-extrusion', source: 'iv-sp-' + L.id, paint: { 'fill-extrusion-color': ['get', 'c'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.9, 'fill-extrusion-vertical-gradient': true } });
      // edges in the chosen edge colour (on the ground floor, where the edges sit flat)
      if ((L.z || 0) === 0) layer({ id: 'iv-sl-' + L.id, type: 'line', source: 'iv-sp-' + L.id, paint: { 'line-color': ['get', 'l'], 'line-width': ['interpolate', ['linear'], ['zoom'], 16, 0.4, 20, 1.6] } });
    });
    // walkways: narrow raised strips on the walking surface of each floor, so passengers see where they can walk
    levels().forEach((L) => { const wf = [];
      M.paths.filter((p) => p.lv === L.id && Array.isArray(p.pts)).forEach((p) => { for (let i = 1; i < p.pts.length; i++) { const a = { ll: p.pts[i - 1], lv: L.id }, c = { ll: p.pts[i], lv: L.id }; if (I.metres(a.ll, c.ll) < 0.3) continue;
        const poly = I.bufferLine(F, [a.ll, c.ll], 0.7), h0 = baseH(L.id) + heightOn(M, F, { ll: [(a.ll[0] + c.ll[0]) / 2, (a.ll[1] + c.ll[1]) / 2], lv: L.id });
        wf.push({ type: 'Feature', properties: { b: h0, h: h0 + 0.12 }, geometry: { type: 'Polygon', coordinates: [[...poly, poly[0]].map((q) => [q[1], q[0]])] } }); } });
      src('iv-wk-' + L.id, fc(wf));
      layer({ id: 'iv-wk-' + L.id, type: 'fill-extrusion', source: 'iv-wk-' + L.id, paint: { 'fill-extrusion-color': (M.style && M.style.walk) || '#7E97BD', 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.85 } });
      V.map.setPaintProperty('iv-wk-' + L.id, 'fill-extrusion-color', (M.style && M.style.walk) || '#7E97BD'); });
    // route ribbon: thin raised strips, at the height of each floor
    const R = D.route; const rf = [];
    if (R && R.pts) for (let i = 1; i < R.pts.length; i++) { const a = R.pts[i - 1], c = R.pts[i]; if (I.metres(a.ll, c.ll) < 0.3) continue;
      const poly = I.bufferLine(F, [a.ll, c.ll], 1.8), h0 = (baseH(a.lv) + baseH(c.lv)) / 2 + (a.lv === c.lv ? heightOn(M, F, a) : 1);
      rf.push({ type: 'Feature', properties: { b: h0, h: h0 + 0.35, lv: a.lv === c.lv ? a.lv : '' }, geometry: { type: 'Polygon', coordinates: [[...poly, poly[0]].map((p) => [p[1], p[0]])] } }); }
    src('iv-route', fc(rf));
    src('iv-route-l', fc(R && R.pts && R.pts.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: R.pts.map((p) => [p.ll[1], p.ll[0]]) } }] : []));
    layer({ id: 'iv-route-l', type: 'line', source: 'iv-route-l', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1A73E8', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 3, 20, 9], 'line-opacity': 0.55 } });
    layer({ id: 'iv-route', type: 'fill-extrusion', source: 'iv-route', paint: { 'fill-extrusion-color': '#1A73E8', 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.95 } });
    order(); markers(); floors(); setLevel(V.lv, true);
    if (!V.fitted) { V.fitted = true; fit(); }
  }
  // height of the walking surface under a point (platform top, bridge deck…)
  function heightOn(M, F, p) { const xy = F.to(p.ll); const s = M.spaces.filter((q) => q.lv === p.lv && !I.OUTLINE(q.kind) && q.pts.length >= 3).find((q) => I.inPoly(xy, q.pts.map(F.to))); const k = s ? I.KIND[s.kind] || I.KIND.other : null; return k && k.h < 2 ? k.h : 0.3; }
  function order() { const L0 = levels(); L0.forEach((L) => { if (V.map.getLayer('iv-sp-' + L.id)) V.map.moveLayer('iv-sp-' + L.id); if (V.map.getLayer('iv-wk-' + L.id)) V.map.moveLayer('iv-wk-' + L.id); }); if (V.map.getLayer('iv-route-l')) V.map.moveLayer('iv-route-l'); if (V.map.getLayer('iv-route')) V.map.moveLayer('iv-route'); }

  function markers() {
    V.markers.forEach((m) => m.remove()); V.markers = []; const D = V.data, M = D.map, ml = V.ml;
    const add = (ll, html, cls, lv, onClick, z) => { const e = document.createElement('div'); e.className = cls; e.innerHTML = html; if (onClick) { e.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); }); e.style.cursor = 'pointer'; }
      const m = new ml.Marker({ element: e, anchor: 'center' }).setLngLat([ll[1], ll[0]]).addTo(V.map); m._lv = lv; if (z) e.style.zIndex = z; V.markers.push(m); return m; };
    // names of the main spaces (platforms, bridges, halls)
    // which names to show: platform numbers, bridge names, areas, amenity names, pillar numbers, point names
    const LB = Object.assign({ pf: true, fob: true, area: true, fac: true, pillar: false, point: false }, D.labels || {});
    const kOf = (k) => (k === 'platform' ? 'pf' : k === 'fob' ? 'fob' : 'area');
    M.spaces.filter((s) => s.name && s.label !== false && ['platform', 'fob', 'concourse', 'hall', 'waiting', 'ticket'].includes(s.kind) && s.pts.length >= 3 && LB[kOf(s.kind)]).forEach((s) => add(I.centroid(s.pts), esc(s.kind === 'platform' ? String(s.name).replace(/^platform\s*/i, 'PF ') : s.name), 'ivm-sl k-' + s.kind, s.lv));
    if (LB.point) (D.points || []).forEach((p) => add(p.ll, `<i></i><span>${esc(p.name)}</span>`, 'ivm-pt' + (p.kind ? ' k-' + p.kind : ''), p.lv, null, 8));
    (D.facs || []).forEach((a) => add(a.ll, `<i style="background:${a.open === false ? '#9AA0A6' : a.color}">${a.icon || ''}</i><span>${esc(a.name)}${a.hi ? `<small>${esc(a.hi)}</small>` : ''}</span>${LB.pillar && a.pillar ? `<em>${esc(String(a.pillar).replace(/^pillar\s*[-:]?\s*/i, 'P '))}</em>` : ''}`, 'ivm-am' + (LB.fac ? ' lbl' : '') + (a.on ? ' on' : '') + (a.dim ? ' dim' : '') + (a.dest ? ' dest' : ''), a.lv, () => opts.onPick && opts.onPick(a.id), a.dest ? 30 : a.on ? 20 : 10));
    const SYM = { photo: '📷', arrow: '↗', qr: 'QR' };
    (D.tasks || []).forEach((t) => add(t.ll, `<b>${SYM[t.kind] || '!'}</b>`, 'ivm-todo k-' + t.kind, t.lv, () => opts.onTask && opts.onTask(t.id), 35));
    if (D.here) add(D.here.ll, '<i></i><b></b><span>You are here · आप यहाँ हैं</span>', 'ivm-here', D.here.lv, null, 40);
  }
  function floors() {
    const L0 = levels().slice().reverse();
    floorsEl.innerHTML = L0.length > 1 ? L0.map((L) => `<button type="button" data-lv="${esc(L.id)}" aria-pressed="${L.id === V.lv}"><b>${esc(L.name)}</b>${L.hi ? `<small>${esc(L.hi)}</small>` : ''}</button>`).join('') : '';
  }
  floorsEl.addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (b) { V.userLv = true; setLevel(b.dataset.lv); } });

  function setLevel(lv, quiet) {
    V.lv = lv; if (!V.ready || !V.data) return;
    const idx = (id) => levels().findIndex((L) => L.id === id), cur = idx(lv);
    levels().forEach((L) => { const id = 'iv-sp-' + L.id; if (!V.map.getLayer(id)) return; const i = idx(L.id); const multi = V.data.route && new Set(V.data.route.pts.map((p) => p.lv)).size > 1; V.map.setPaintProperty(id, 'fill-extrusion-opacity', i === cur ? 0.92 : multi ? 0.6 : i < cur ? 0.35 : 0.12); if (V.map.getLayer('iv-wk-' + L.id)) V.map.setPaintProperty('iv-wk-' + L.id, 'fill-extrusion-opacity', i === cur ? 0.85 : multi ? 0.45 : 0.15); });
    V.markers.forEach((m) => { const e = m.getElement(); const show = m._lv == null || m._lv === lv || e.classList.contains('dest') || e.classList.contains('ivm-here'); e.classList.toggle('other', !show); });
    floorsEl.querySelectorAll('[data-lv]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lv === lv)));
    if (!quiet && opts.onLevel) opts.onLevel(lv);
  }
  function fit(pts) {
    if (!V.map || !V.data) return; const D = V.data; let all = pts;
    if (!all) { const b = D.boundary && D.boundary[0]; all = b && b.length > 2 ? b : [].concat(...D.map.paths.map((p) => p.pts)); }
    if (!all || all.length < 2) return; let bb = null; all.forEach((p) => { bb = bb ? bb.extend([p[1], p[0]]) : new V.ml.LngLatBounds([p[1], p[0]], [p[1], p[0]]); });
    V.map.fitBounds(bb, { padding: { top: 150, bottom: 40, left: 30, right: 70 }, pitch: 45, maxZoom: 19.2, duration: V.fittedOnce ? 700 : 0 }); V.fittedOnce = true;
  }
  return {
    set(data) { const prevKey = V.data && V.data.routeKey; V.data = data; if (!V.userLv && data.here) V.lv = data.here.lv; draw();
      if (data.route && data.routeKey !== prevKey) fit(data.route.pts.map((p) => p.ll)); else if (!data.route && prevKey) fit(); },
    level: (lv) => setLevel(lv), fit: () => fit(), resize: () => V.map && V.map.resize(),
    destroy() { try { V.map && V.map.remove(); } catch { /* ignore */ } el.innerHTML = ''; },
  };
}
