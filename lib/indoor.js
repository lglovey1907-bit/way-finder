// Indoor map of the station, drawn by staff (Mappedin-style), and routing on it.
//
// The map:  { levels:[{id,name,hi,z}], spaces:[{id,lv,kind,name,pts,pf?}], paths:[{id,lv,pts}],
//             links:[{id,kind,a:{lv,ll},b:{lv,ll},name}], live }
//   spaces  = areas drawn as polygons (platforms, concourse, FOB decks, rooms, shops…), shown in 3D
//   paths   = walkways: where people really walk. Routes follow these lines exactly.
//   links   = stairs, lifts, escalators and ramps joining two floors.
// Walkways join wherever they meet: shared corners (within 1.2 m), a line ending on another line
// (within 1.5 m), or two lines crossing.

export const LEVEL_H = 6; // metres between floors in the 3D view
export const KINDS = [
  // id, label, Hindi, colour, height in 3D (m)
  ['platform', 'Platform', 'प्लेटफॉर्म', '#F2E3B3', 0.9],
  ['concourse', 'Concourse / circulating area', 'कॉनकोर्स', '#E4EAF2', 0.25],
  ['fob', 'Foot over bridge deck', 'फुट ओवर ब्रिज', '#C3D3EA', 0.8],
  ['hall', 'Hall / passage', 'हॉल', '#EDF1F6', 0.3],
  ['waiting', 'Waiting hall / lounge', 'प्रतीक्षालय', '#E3DAF6', 3],
  ['ticket', 'Ticket hall / counters', 'टिकट घर', '#D9E1FA', 3],
  ['shop', 'Shop / stall', 'दुकान', '#FCE0CB', 2.6],
  ['food', 'Food court / restaurant', 'भोजन', '#FFD5C2', 2.6],
  ['toilet', 'Toilet block', 'शौचालय', '#CFEBFA', 2.6],
  ['room', 'Room / office', 'कमरा', '#FFFFFF', 3],
  ['stairs', 'Stairs / lift area', 'सीढ़ी', '#B9C4D2', 1.2],
  ['parking', 'Parking', 'पार्किंग', '#E2E2E2', 0.1],
  ['track', 'Tracks (no walking)', 'ट्रैक', '#C8C1B2', 0.05],
  ['stationarea', 'Station area boundary', 'स्टेशन क्षेत्र', '#FFFFFF', 0],
  ['building', 'Station building outline', 'स्टेशन भवन', '#FFFFFF', 0],
  ['other', 'Other area', 'अन्य', '#ECEFF2', 0.5],
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k[0], { id: k[0], label: k[1], hi: k[2], color: k[3], h: k[4] }]));
// outlines only (not raised in 3D, not a place you can be "in")
export const OUTLINE = (k) => k === 'building' || k === 'stationarea';
const LINE_DEF = { stationarea: '#111111', building: '#FFFFFF' };
// colour of a space: staff can pick fill, line and how light or dark it shows (shade 0 = very light, 0.5 = as picked, 1 = very dark);
// style.shade (whole map) is added on top
export function mixShade(hex, shade) {
  const h = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!h) return hex; const n = parseInt(h[1], 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = Math.max(0, Math.min(1, shade == null ? 0.5 : shade));
  if (t < 0.5) { const k = (0.5 - t) * 2 * 0.85; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; } else { const k = (t - 0.5) * 2 * 0.7; r *= 1 - k; g *= 1 - k; b *= 1 - k; }
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}
export function styleOf(s, style) {
  const k = KIND[s.kind] || KIND.other, base = s.shade == null ? 0.5 : +s.shade, adj = style && style.shade != null ? +style.shade - 0.5 : 0;
  const sh = Math.max(0, Math.min(1, base + adj));
  return { fill: mixShade(s.color || k.color, sh), line: mixShade(s.line || LINE_DEF[s.kind] || '#7A8594', OUTLINE(s.kind) ? 0.5 : Math.max(0.5, sh)), shade: sh, raw: s.color || k.color, rawLine: s.line || LINE_DEF[s.kind] || '#7A8594' };
}
export const LINKS = [['stairs', 'Stairs', 'सीढ़ियाँ'], ['lift', 'Lift', 'लिफ्ट'], ['esc', 'Escalator', 'एस्केलेटर'], ['ramp', 'Ramp', 'रैंप']];
export const LINK = Object.fromEntries(LINKS.map((k) => [k[0], { id: k[0], label: k[1], hi: k[2] }]));
const LINK_COST = { stairs: 12, lift: 35, esc: 8, ramp: 4 };

export const MERGE = 1.2, TSNAP = 1.5, LINK_SNAP = 12;

// ---------- geometry ----------
const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
export function frame(o) {
  const kx = (R * Math.cos(rad(o[0])) * Math.PI) / 180, ky = (R * Math.PI) / 180;
  return { to: (p) => [(p[1] - o[1]) * kx, (p[0] - o[0]) * ky], ll: (x, y) => [+(o[0] + y / ky).toFixed(7), +(o[1] + x / kx).toFixed(7)] };
}
export function metres(a, b) {
  const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function projT(p, a, b) { const vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy; if (!L2) return { t: 0, x: a[0], y: a[1], d: Math.hypot(p[0] - a[0], p[1] - a[1]) }; let t = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2; t = Math.max(0, Math.min(1, t)); const x = a[0] + vx * t, y = a[1] + vy * t; return { t, x, y, d: Math.hypot(p[0] - x, p[1] - y) }; }
function cross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6 ? { t, u } : null;
}
export function inPoly(p, poly) { // p, poly in the same flat frame
  let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]) c = !c; }
  return c;
}
export function polyArea(xy) { let s = 0; for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }
export function centroid(pts) { const n = pts.length || 1; return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n]; }
// a polygon around a line, w metres each side (for drawing platforms, bridges and the route ribbon)
export function bufferLine(F, ll, w) {
  const P = ll.map(F.to); if (P.length < 2) return [];
  const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return [-dy / L, dx / L]; };
  const side = (s) => P.map((p, i) => {
    const n1 = i > 0 ? nrm(P[i - 1], p) : null, n2 = i < P.length - 1 ? nrm(p, P[i + 1]) : null;
    let n = n1 && n2 ? [n1[0] + n2[0], n1[1] + n2[1]] : n1 || n2; const L = Math.hypot(n[0], n[1]) || 1; n = [n[0] / L, n[1] / L];
    const cos = n1 && n2 ? Math.max(0.35, n[0] * n1[0] + n[1] * n1[1]) : 1;
    return [p[0] + (n[0] * w * s) / cos, p[1] + (n[1] * w * s) / cos];
  });
  return side(1).concat(side(-1).reverse()).map((q) => F.ll(q[0], q[1]));
}

export const levelOf = (map, id) => (map.levels || []).find((l) => l.id === id) || null;
export const levelIndex = (map, id) => { const L = (map.levels || []).slice().sort((a, b) => (a.z || 0) - (b.z || 0)); return Math.max(0, L.findIndex((l) => l.id === id)); };
export function origin(map) {
  for (const p of map.paths || []) if (p.pts && p.pts.length) return p.pts[0];
  for (const s of map.spaces || []) if (s.pts && s.pts.length) return s.pts[0];
  return [28.6425, 77.2195];
}
export const emptyMap = () => ({ v: 1, style: { bg: 0.32, shade: 0.5 }, levels: [{ id: 'g', name: 'Ground', hi: 'भूतल', z: 0 }, { id: 'f', name: 'FOB level', hi: 'फुट ओवर ब्रिज स्तर', z: 1 }], spaces: [], paths: [], links: [], live: false });

// ---------- the walking network ----------
export function buildGraph(map) {
  const F = frame(origin(map)), nodes = [], adj = [], edges = [], byLv = {}, grid = {};
  const key = (lv, x, y) => lv + ':' + Math.floor(x / MERGE) + ':' + Math.floor(y / MERGE);
  function node(lv, x, y) {
    const gx = Math.floor(x / MERGE), gy = Math.floor(y / MERGE); let best = null, bd = MERGE;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const id of grid[lv + ':' + (gx + i) + ':' + (gy + j)] || []) { const n = nodes[id], d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = id; } }
    if (best != null) return best;
    const id = nodes.length; nodes.push({ id, lv, x, y, ll: F.ll(x, y) }); adj.push([]); (grid[key(lv, x, y)] = grid[key(lv, x, y)] || []).push(id); return id;
  }
  function edge(a, b, kind, extra) { if (a === b) return; const n1 = nodes[a], n2 = nodes[b]; const len = n1.lv === n2.lv ? Math.hypot(n1.x - n2.x, n1.y - n2.y) : Math.hypot(n1.x - n2.x, n1.y - n2.y) + (kind === 'lift' ? 0 : 8);
    const e = Object.assign({ a, b, kind, len, cost: len + (LINK_COST[kind] || 0) }, extra || {}); edges.push(e); adj[a].push(e); if (!e.oneway) adj[b].push(Object.assign({}, e, { a: b, b: a, rev: true })); }
  const zOf = {}; (map.levels || []).forEach((l) => { zOf[l.id] = +l.z || 0; });
  const levels = (map.levels || []).map((l) => l.id);
  const linkEnds = []; (map.links || []).forEach((k) => ['a', 'b'].forEach((w) => { if (k[w] && Array.isArray(k[w].ll)) linkEnds.push({ k, w, lv: k[w].lv, p: F.to(k[w].ll) }); }));
  levels.forEach((lv) => {
    const segs = []; (map.paths || []).filter((p) => p.lv === lv && Array.isArray(p.pts)).forEach((p) => { const P = p.pts.map(F.to); for (let i = 1; i < P.length; i++) if (Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]) > 0.05) segs.push({ a: P[i - 1], b: P[i], w: p.id, dir: p.dir === 'fwd' || p.dir === 'back' ? p.dir : '' }); });
    const ts = segs.map(() => [0, 1]);
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) { const c = cross(segs[i].a, segs[i].b, segs[j].a, segs[j].b); if (c) { ts[i].push(c.t); ts[j].push(c.u); } }
    for (let i = 0; i < segs.length; i++) for (const p of [segs[i].a, segs[i].b]) for (let j = 0; j < segs.length; j++) { if (j === i) continue; const q = projT(p, segs[j].a, segs[j].b); if (q.d < TSNAP && q.t > 0.001 && q.t < 0.999) ts[j].push(q.t); }
    // stairs/lift ends join the nearest walkway on their floor
    linkEnds.filter((e) => e.lv === lv).forEach((e) => { let best = null; segs.forEach((s, i) => { const q = projT(e.p, s.a, s.b); if (!best || q.d < best.q.d) best = { i, q }; }); if (best && best.q.d <= LINK_SNAP) { ts[best.i].push(best.q.t); e.at = [best.q.x, best.q.y]; e.off = best.q.d; } else { e.at = e.p; e.off = best ? best.q.d : Infinity; } });
    byLv[lv] = [];
    segs.forEach((s, i) => { const T = [...new Set(ts[i].map((t) => Math.round(t * 1e6) / 1e6))].sort((x, y) => x - y); let prev = null;
      T.forEach((t) => { const id = node(lv, s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t); if (prev != null && prev !== id && !adj[prev].some((e) => e.b === id && e.kind === 'walk') && !adj[id].some((e) => e.b === prev && e.kind === 'walk' && e.oneway)) { if (s.dir === 'back') edge(id, prev, 'walk', { w: s.w, oneway: true }); else edge(prev, id, 'walk', { w: s.w, oneway: s.dir === 'fwd' }); byLv[lv].push(edges[edges.length - 1]); } prev = id; }); });
  });
  const linkInfo = {};
  (map.links || []).forEach((k) => { const ea = linkEnds.find((e) => e.k === k && e.w === 'a'), eb = linkEnds.find((e) => e.k === k && e.w === 'b'); if (!ea || !eb || !ea.at || !eb.at) return;
    const na = node(ea.lv, ea.at[0], ea.at[1]), nb = node(eb.lv, eb.at[0], eb.at[1]), aLow = (zOf[ea.lv] || 0) <= (zOf[eb.lv] || 0), lo = aLow ? na : nb, hi = aLow ? nb : na;
    // up only: from the lower floor to the upper one; down only: the other way
    if (k.dir === 'up') edge(lo, hi, k.kind || 'stairs', { link: k.id, name: k.name || '', oneway: true }); else if (k.dir === 'down') edge(hi, lo, k.kind || 'stairs', { link: k.id, name: k.name || '', oneway: true }); else edge(na, nb, k.kind || 'stairs', { link: k.id, name: k.name || '' }); linkInfo[k.id] = { offA: ea.off, offB: eb.off, na, nb }; });
  const g = { F, nodes, adj, edges, byLv, linkInfo, map };
  g.spaceAt = spaceFinder(map, F);
  return g;
}

function spaceFinder(map, F) {
  const S = (map.spaces || []).filter((s) => Array.isArray(s.pts) && s.pts.length >= 3 && !OUTLINE(s.kind)).map((s) => { const xy = s.pts.map(F.to); return { s, xy, area: polyArea(xy) }; }).sort((a, b) => a.area - b.area);
  const edgeD = (p, xy) => { let d = Infinity; for (let i = 0; i < xy.length; i++) d = Math.min(d, projT(p, xy[i], xy[(i + 1) % xy.length]).d); return d; };
  return (lv, ll) => { const p = F.to(ll); const h = S.find((q) => q.s.lv === lv && inPoly(p, q.xy)); if (h) return h.s;
    let best = null; S.forEach((q) => { if (q.s.lv !== lv) return; const d = edgeD(p, q.xy); if (d < 4 && (!best || d < best.d)) best = { d, s: q.s }; }); return best ? best.s : null; };
}

// nearest point on a walkway of a floor
export function snap(g, lv, ll) {
  const p = g.F.to(ll); let best = null;
  for (const e of g.byLv[lv] || []) { const A = g.nodes[e.a], B = g.nodes[e.b], q = projT(p, [A.x, A.y], [B.x, B.y]); if (!best || q.d < best.d) best = { e, t: q.t, x: q.x, y: q.y, d: q.d }; }
  if (!best) return null;
  return { a: best.e.a, b: best.e.b, ta: best.t * best.e.len, tb: (1 - best.t) * best.e.len, ll: g.F.ll(best.x, best.y), d: best.d, lv, raw: ll };
}

// one-to-all shortest distances from a point (for "nearest" lists and for the route)
export function fromPoint(g, lv, ll, opts = {}) {
  const s = snap(g, lv, ll); if (!s) return null;
  const n = g.nodes.length, dist = new Float64Array(n).fill(Infinity), len = new Float64Array(n).fill(Infinity), prev = new Array(n).fill(null);
  const heap = []; const push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k > 0) { const pk = (k - 1) >> 1; if (heap[pk][0] <= heap[k][0]) break; [heap[pk], heap[k]] = [heap[k], heap[pk]]; k = pk; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  dist[s.a] = s.ta; len[s.a] = s.ta; push(s.ta, s.a); if (s.tb < dist[s.b]) { dist[s.b] = s.tb; len[s.b] = s.tb; push(s.tb, s.b); }
  while (heap.length) { const [d, i] = pop(); if (d > dist[i]) continue;
    for (const e of g.adj[i]) { if (opts.stepFree && e.kind === 'stairs') continue; const ek = opts.penalty || opts.mult ? (e.a < e.b ? e.a + '-' + e.b : e.b + '-' + e.a) : ''; const nd = d + e.cost * ((opts.mult && opts.mult.get(ek)) || 1) + (opts.penalty && opts.penalty.has(ek) ? (opts.penaltyCost || 400) : 0); if (nd < dist[e.b]) { dist[e.b] = nd; len[e.b] = len[i] + e.len; prev[e.b] = { from: i, e }; push(nd, e.b); } } }
  return { g, s, dist, len, prev, opts };
}
// cost and walking length to a point (or the best of several points)
export function toPoint(R0, lv, ll) {
  const t = snap(R0.g, lv, ll); if (!t) return null; const s = R0.s;
  let best = { cost: R0.dist[t.a] + t.ta, len: R0.len[t.a] + t.ta, end: t.a, t };
  if (R0.dist[t.b] + t.tb < best.cost) best = { cost: R0.dist[t.b] + t.tb, len: R0.len[t.b] + t.tb, end: t.b, t };
  // both on the same walkway piece
  if ((s.a === t.a && s.b === t.b) || (s.a === t.b && s.b === t.a)) { const direct = s.a === t.a ? Math.abs(s.ta - t.ta) : Math.abs(s.ta - t.tb); if (direct <= best.cost) best = { cost: direct, len: direct, end: null, t, direct: true }; }
  best.cost += t.d + R0.s.d; best.len += t.d + R0.s.d; return isFinite(best.cost) ? best : null;
}
// the route as points with floors and what joins them
export function pathTo(R0, hit) {
  const g = R0.g, s = R0.s, t = hit.t, out = [];
  const add = (ll, lv, kind) => { const last = out[out.length - 1]; if (last && last.lv === lv && metres(last.ll, ll) < 0.05) { if (kind && kind !== 'walk') last.kind = kind; return; } out.push({ ll, lv, kind: kind || 'walk' }); };
  add(s.raw, s.lv); add(s.ll, s.lv);
  if (!hit.direct) {
    const seq = []; let i = hit.end; while (i != null) { seq.push(i); const p = R0.prev[i]; i = p ? p.from : null; } seq.reverse();
    seq.forEach((id, k) => { const n = g.nodes[id], p = R0.prev[id]; add(n.ll, n.lv, k === 0 || !p ? 'walk' : p.e.kind); if (p && p.e.kind !== 'walk') out[out.length - 1].link = { kind: p.e.kind, name: p.e.name, up: levelIndex(g.map, n.lv) > levelIndex(g.map, g.nodes[p.from].lv) }; });
  }
  add(t.ll, t.lv); add(t.raw, t.lv);
  return out;
}
export function route(g, from, to, opts) {
  const R0 = fromPoint(g, from.lv, from.ll, opts); if (!R0) return null;
  const targets = to.many || [to]; let best = null;
  targets.forEach((q) => { const h = toPoint(R0, q.lv, q.ll); if (h && (!best || h.cost < best.cost)) best = h; });
  if (!best) return null;
  return { pts: pathTo(R0, best), len: best.len, cost: best.cost };
}

// a route through set points, in order (admin-defined routes: "Gate 4 → Platform 16 via Platform 1").
// via = [{lv, ll}]; each leg follows the walkways. Returns null if any leg can't be walked.
export function routeVia(g, from, via, to, opts) {
  const stops = [from, ...(via || [])]; let pts = [], len = 0;
  for (let i = 0; i < stops.length; i++) {
    const last = i === stops.length - 1, r = route(g, stops[i], last ? to : stops[i + 1], opts); if (!r) return null;
    const leg = r.pts.slice(); if (pts.length) { leg.shift(); if (leg.length && pts.length && metres(pts[pts.length - 1].ll, leg[0].ll) < 0.05 && pts[pts.length - 1].lv === leg[0].lv) leg.shift(); }
    pts = pts.concat(leg); len += r.len;
  }
  // drop the out-and-back stub where a via point sits a little off its walkway
  return { pts, len, cost: len };
}

// separate pieces of the network (should be one); used by the map checks
export function islands(g) {
  const seen = new Int32Array(g.nodes.length).fill(-1), out = [];
  for (let i = 0; i < g.nodes.length; i++) { if (seen[i] >= 0) continue; const st = [i], ids = []; seen[i] = out.length; while (st.length) { const k = st.pop(); ids.push(k); for (const e of g.adj[k]) if (seen[e.b] < 0) { seen[e.b] = out.length; st.push(e.b); } } out.push(ids); }
  return out.sort((a, b) => b.length - a.length);
}

// ---------- turn-by-turn ----------
const brg = (a, b) => { const y = Math.sin(rad(b[1] - a[1])) * Math.cos(rad(b[0])), x = Math.cos(rad(a[0])) * Math.sin(rad(b[0])) - Math.sin(rad(a[0])) * Math.cos(rad(b[0])) * Math.cos(rad(b[1] - a[1])); return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360; };
const spaceName = (s) => (s ? (s.name || (KIND[s.kind] || KIND.other).label) : '');
const spaceHi = (s) => (s ? (s.nameHi || s.name || (KIND[s.kind] || KIND.other).hi) : '');
// pts from route(); names: {level(id)->{en,hi}}; dest {name}
export function moves(g, pts, dest) {
  const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + metres(pts[i - 1].ll, pts[i].ll)); // same measure as the navigation screen
  const lvName = (id) => { const L = levelOf(g.map, id) || { name: id, hi: id }; return { en: L.name, hi: L.hi || L.name }; };
  const out = [], push = (m) => { const last = out[out.length - 1]; if (m.type !== 'arrive' && last && Math.abs(last.d - m.d) < 4 && last.type !== 'straight' && !/stairs|lift|esc/.test(m.type)) return; out.push(m); };
  const sp0 = g.spaceAt(pts[0].lv, pts[0].ll);
  push({ d: 0, type: 'straight', hi: sp0 ? `${spaceHi(sp0)} पर सीधे चलें` : 'नीली लाइन पर सीधे चलें', en: sp0 ? `Walk along ${spaceName(sp0)}` : 'Follow the blue line', i: 0 });
  let curSp = sp0;
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    if (p.link) { const to = lvName(p.lv), up = p.link.up, k = p.link.kind, sp = g.spaceAt(p.lv, p.ll), where = sp ? spaceName(sp) : to.en, whereHi = sp ? spaceHi(sp) : to.hi;
      const m = k === 'lift' ? { type: up ? 'liftup' : 'liftdown', hi: `लिफ्ट से ${up ? 'ऊपर' : 'नीचे'} ${whereHi} पर जाएँ`, en: `Take the lift ${up ? 'up' : 'down'} to ${where}`, hiNow: `अब लिफ्ट लें`, enNow: 'Take the lift now' }
        : k === 'esc' ? { type: up ? 'escup' : 'escdown', hi: `एस्केलेटर से ${up ? 'ऊपर' : 'नीचे'} ${whereHi} पर जाएँ`, en: `Take the escalator ${up ? 'up' : 'down'} to ${where}`, hiNow: 'अब एस्केलेटर लें', enNow: 'Take the escalator now' }
        : { type: up ? 'stairsup' : 'stairsdown', hi: `सीढ़ियाँ ${up ? 'चढ़कर' : 'उतरकर'} ${whereHi} पर जाएँ`, en: `${up ? 'Climb the stairs up' : 'Take the stairs down'} to ${where}`, hiNow: `अब सीढ़ियाँ ${up ? 'चढ़ें' : 'उतरें'}`, enNow: up ? 'Climb the stairs now' : 'Go down the stairs now' };
      push(Object.assign({ d: cum[i - 1], i: i - 1 }, m)); curSp = sp; continue; }
    const sp = g.spaceAt(p.lv, p.ll), same = (x, y) => !!x && !!y && x.kind === y.kind && spaceName(x) === spaceName(y), named = sp && !same(sp, curSp) && ['platform', 'concourse', 'fob', 'hall', 'waiting', 'ticket'].includes(sp.kind) ? sp : null;
    const a = pts.slice(0, i).reverse().find((q) => q.lv === p.lv && metres(q.ll, p.ll) > 2.5), b = pts.slice(i + 1).find((q) => q.lv === p.lv && metres(q.ll, p.ll) > 2.5);
    if (!a || !b || pts[i + 1].link) { if (sp) curSp = sp; continue; }
    const dl = ((brg(p.ll, b.ll) - brg(a.ll, p.ll) + 540) % 360) - 180, ad = Math.abs(dl), R = dl > 0;
    if (ad < 28) { if (named) { push({ d: cum[i], i, type: 'platform', hi: `सीधे ${spaceHi(named)} पर जाएँ`, en: `Go straight onto ${spaceName(named)}` }); curSp = sp; } continue; }
    const t = ad > 150 ? 'uturn' : ad < 60 ? (R ? 'slightright' : 'slightleft') : R ? 'right' : 'left';
    const wh = { uturn: ['पीछे मुड़ें', 'Turn around'], slightright: ['थोड़ा दाएँ मुड़ें', 'Keep slightly right'], slightleft: ['थोड़ा बाएँ मुड़ें', 'Keep slightly left'], right: ['दाएँ मुड़ें', 'Turn right'], left: ['बाएँ मुड़ें', 'Turn left'] }[t];
    push({ d: cum[i], i, type: t, hi: named ? `${wh[0].replace('मुड़ें', 'मुड़कर')} ${spaceHi(named)} पर जाएँ` : wh[0], en: named ? `${wh[1]} onto ${spaceName(named)}` : wh[1], hiNow: `अब ${wh[0]}`, enNow: `${wh[1]} now` });
    if (sp) curSp = sp;
  }
  const total = cum[cum.length - 1];
  push({ d: total, i: pts.length - 1, type: 'arrive', hi: `${dest.nameHi || dest.name} पर पहुँचें`, en: `Arrive at ${dest.name}` });
  return { moves: out, cum, total };
}
