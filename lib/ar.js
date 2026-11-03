// AR navigation.
// Start: the passenger stands at the QR board they scanned, facing it. The board's surveyed position and the direction
// it faces (recorded by staff) line the station model up with the camera.
//  • Phones with WebXR AR (Android Chrome + ARCore): blue arrows on the floor along the route, signs at each step and the
//    destination pin. The phone's own tracking follows the walk; the banner shows the current step and distance.
//  • Other phones (iPhone Safari, older Android): camera view with a large arrow that turns with the compass to point
//    along the route, plus the step and distance (position from GPS, or tap "Next step").

const R = 6371008.8, rad = (d) => d * Math.PI / 180, deg = (r) => r * 180 / Math.PI;
const norm = (d) => ((d % 360) + 360) % 360;

// ---------- compass ----------
// Heading (degrees from north, clockwise) of the back camera from a deviceorientation event.
export function headingFrom(e) {
  if (typeof e.webkitCompassHeading === 'number' && !isNaN(e.webkitCompassHeading)) return norm(e.webkitCompassHeading); // iPhone
  if (e.alpha == null || !(e.absolute || e.type === 'deviceorientationabsolute')) return null;
  const a = rad(e.alpha), b = rad(e.beta || 0), g = rad(e.gamma || 0);
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // back camera = device −Z, turned into east / north
  const east = -(cG * sA * sB + cA * sG), north = -(sA * sG - cA * cG * sB);
  if (Math.hypot(east, north) < 0.2) { // phone held flat: use the top edge instead
    const e2 = -cB * sA, n2 = cA * cB; return norm(deg(Math.atan2(e2, n2)));
  }
  return norm(deg(Math.atan2(east, north)));
}
export async function compassPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') { try { return (await D.requestPermission()) === 'granted'; } catch { return false; } }
  return !!D;
}
// Average heading over a short time (call from a tap, so iPhone can ask for permission).
export async function readCompass(ms = 1500) {
  if (!(await compassPermission())) throw new Error('Compass not available on this phone.');
  return new Promise((resolve, reject) => {
    const xs = [], ys = [];
    const h = (e) => { const d = headingFrom(e); if (d == null) return; xs.push(Math.sin(rad(d))); ys.push(Math.cos(rad(d))); };
    window.addEventListener('deviceorientationabsolute', h); window.addEventListener('deviceorientation', h);
    setTimeout(() => {
      window.removeEventListener('deviceorientationabsolute', h); window.removeEventListener('deviceorientation', h);
      if (!xs.length) { reject(new Error("The compass didn't answer. Move the phone in a figure of eight and try again.")); return; }
      const x = xs.reduce((s, v) => s + v, 0), y = ys.reduce((s, v) => s + v, 0);
      resolve(Math.round(norm(deg(Math.atan2(x, y)))));
    }, ms);
  });
}

// ---------- geometry (local metres: E east, N north) ----------
function enuFrame(lat0, lng0) {
  const kx = 111320 * Math.cos(rad(lat0)), ky = 110540;
  return { to: (lat, lng) => [(lng - lng0) * kx, (lat - lat0) * ky], from: (E, N) => [lat0 + N / ky, lng0 + E / kx] };
}
function cumLen(P) { const c = [0]; for (let i = 1; i < P.length; i++) c.push(c[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1])); return c; }
function projectENU(P, cum, q) {
  let best = null;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L2)) : 0;
    const x = a[0] + dx * t, y = a[1] + dy * t, off = Math.hypot(q[0] - x, q[1] - y);
    if (!best || off < best.off) best = { d: cum[i - 1] + Math.sqrt(L2) * t, off, i: i - 1 };
  }
  return best || { d: 0, off: 0, i: 0 };
}
function pointAt(P, cum, d) {
  d = Math.max(0, Math.min(cum[cum.length - 1], d));
  for (let i = 1; i < P.length; i++) if (d <= cum[i]) { const t = (d - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [P[i - 1][0] + (P[i][0] - P[i - 1][0]) * t, P[i - 1][1] + (P[i][1] - P[i - 1][1]) * t, i - 1, t]; }
  const L = P[P.length - 1]; return [L[0], L[1], P.length - 2, 1];
}
// world (E,N) ↔ AR space (x right, −z forward at the start, facing heading h)
export function enuToXR(E, N, h) { const c = Math.cos(rad(h)), s = Math.sin(rad(h)); return { x: E * c - N * s, z: -(E * s + N * c) }; }
export function xrToENU(x, z, h) { const c = Math.cos(rad(h)), s = Math.sin(rad(h)); return { E: x * c - z * s, N: -x * s - z * c }; }

// ---------- UI shell ----------
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function shell() {
  let el = document.getElementById('arView');
  if (!el) { el = document.createElement('div'); el.id = 'arView'; el.className = 'arview'; document.body.appendChild(el); }
  el.hidden = false; document.body.classList.add('fs-lock');
  return el;
}
function iconFor(t) { t = String(t || ''); return /lift/i.test(t) ? '⇅' : /escalator/i.test(t) ? '↗' : /stairs|steps/i.test(t) ? '≡' : /arrive/i.test(t) ? '●' : '↑'; }

export async function arSupport() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { return false; }
}

// route: { line:[[lat,lng]…], h:[metres above ground per point], steps:[{t,s}], stepEnd:[metres], dest:{name}, start:{name, head} }
export async function openAR(route) {
  const THREE = window.THREE, el = shell();
  const xr = await arSupport();
  const startHead = route.start && typeof route.start.head === 'number' ? route.start.head : null;
  el.innerHTML = `<div class="ar-intro">
      <p class="label">AR view · कैमरा से रास्ता</p>
      <h3>Stand at the QR board: ${esc(route.start ? route.start.name : '')}</h3>
      <ol>
        <li>Stand right in front of the board and <b>face it</b>, holding the phone upright.</li>
        <li>Tap <b>Start AR</b>. ${xr ? 'Move the phone slowly left and right for a second so it can see the floor.' : 'Allow the camera and motion sensors when asked.'}</li>
        <li>Follow the blue arrows. Keep looking up at the station signs too.</li>
      </ol>
      ${startHead == null ? '<p class="msg">This board\'s direction hasn\'t been recorded yet, so the phone\'s compass is used. Arrows may point a little off; use ⟲ ⟳ to turn them.</p>' : ''}
      <p class="msg">${xr ? 'Your phone supports full AR: arrows are placed on the floor and follow your walk.' : 'Your phone shows a guiding arrow over the camera, steered by the compass. Full floor arrows need an Android phone with ARCore in Chrome.'}</p>
      <div class="actions"><button class="btn primary" type="button" id="arGo">Start AR</button><button class="btn" type="button" id="arPrev">Preview on this screen</button><button class="btn" type="button" id="arX">Close</button></div>
      <p class="msg err" id="arErr" role="status"></p></div>`;
  const close = () => { el.hidden = true; el.innerHTML = ''; document.body.classList.remove('fs-lock'); };
  el.querySelector('#arX').onclick = close;
  el.querySelector('#arPrev').onclick = () => { let head = startHead; if (head == null) { const F = enuFrame(route.line[0][0], route.line[0][1]), b = F.to(route.line[1][0], route.line[1][1]); head = norm(deg(Math.atan2(b[0], b[1]))); } runPreview(THREE, el, route, head, close); };
  el.querySelector('#arGo').onclick = async () => {
    const err = el.querySelector('#arErr'); err.textContent = '';
    let head = startHead;
    try { const live = await readCompass(900); if (head == null) head = live; } catch (e) { if (head == null) head = null; }
    if (head == null) {
      // last resort: assume the passenger faces along the first part of the route
      const F = enuFrame(route.line[0][0], route.line[0][1]), b = F.to(route.line[1][0], route.line[1][1]);
      head = norm(deg(Math.atan2(b[0], b[1])));
    }
    try { if (xr) await runXR(THREE, el, route, head, close); else await runCompass(THREE, el, route, head, close); }
    catch (e) { err.textContent = (e && e.message) || 'AR could not start on this phone.'; }
  };
}

function hud(el, route, onNudge, onExit, extra) {
  el.innerHTML = `<div class="ar-hud" id="arHud">
      <div class="ar-banner" role="status" aria-live="polite"><span class="ar-ic" id="arIc">↑</span><div><b id="arT">Finding the floor…</b><span id="arS">Move the phone slowly left and right.</span></div></div>
      <div class="ar-ctl">
        <button class="btn sm" type="button" data-nudge="-5" aria-label="Turn arrows left">⟲</button>
        <button class="btn sm" type="button" data-nudge="5" aria-label="Turn arrows right">⟳</button>
        ${extra || ''}
        <button class="btn sm" type="button" id="arExit">✕ Exit AR</button>
      </div></div>`;
  el.querySelectorAll('[data-nudge]').forEach((b) => b.onclick = () => onNudge(+b.dataset.nudge));
  el.querySelector('#arExit').onclick = onExit;
  return {
    set(t, s, ic) { const a = el.querySelector('#arT'), b = el.querySelector('#arS'), c = el.querySelector('#arIc'); if (a) a.textContent = t; if (b) b.textContent = s || ''; if (c) c.textContent = ic || '↑'; },
  };
}
function progressText(route, d, off) {
  const total = route.stepEnd[route.stepEnd.length - 1] || 0, left = Math.max(0, total - d);
  let i = route.stepEnd.findIndex((e) => e > d + 3); if (i < 0) i = route.steps.length - 1;
  const s = route.steps[i] || {}, nx = route.steps[i + 1];
  if (left < 6) return { t: `You have arrived at ${route.dest ? route.dest.name : 'your destination'}`, s: s.s || '', ic: '●', i };
  if (off > 25) return { t: `You're about ${Math.round(off)} m from the route`, s: 'Walk back towards the blue arrows, or go back to a QR board and start AR again.', ic: '↺', i };
  return { t: s.t || 'Follow the arrows', s: `${Math.max(0, Math.round(route.stepEnd[i] - d))} m${nx ? ' · then ' + nx.t.replace(/^Arrive at /, 'arrive at ') : ''} · ${Math.round(left)} m left`, ic: iconFor(s.t), i };
}

// The AR scene: floor chevrons every 1.6 m along the route, a sign at each step, the destination pin.
function arScene(THREE, route, P, H, cum, total, getHead) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
  const root = new THREE.Group(); scene.add(root);
  const blue = new THREE.MeshBasicMaterial({ color: 0x1a73e8, transparent: true, opacity: 0.9 });
  const yellow = new THREE.MeshBasicMaterial({ color: 0xf3c531 });
  // chevron shape lying on the floor, pointing along −z
  const chev = new THREE.Shape(); chev.moveTo(0, 0.45); chev.lineTo(0.42, -0.05); chev.lineTo(0.26, -0.18); chev.lineTo(0, 0.12); chev.lineTo(-0.26, -0.18); chev.lineTo(-0.42, -0.05); chev.lineTo(0, 0.45);
  const chevGeo = new THREE.ShapeGeometry(chev);
  const arrows = [];
  const label = (text, bg) => {
    const c = document.createElement('canvas'), g = c.getContext('2d'), f = '700 54px "Barlow Condensed","Arial Narrow",sans-serif';
    g.font = f; const w = Math.min(1600, g.measureText(text).width + 60); c.width = w; c.height = 96; g.font = f;
    g.fillStyle = bg || '#18212B'; g.fillRect(0, 0, w, 96); g.fillStyle = bg === '#F3C531' ? '#151515' : '#fff'; g.textBaseline = 'middle'; g.fillText(text, 30, 50);
    const t = new THREE.CanvasTexture(c); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false })); s.scale.set(w / 96 * 0.45, 0.45, 1); return s;
  };
  function build() {
    while (root.children.length) root.remove(root.children[0]); arrows.length = 0;
    for (let d = 1.2; d < total - 0.5; d += 1.6) {
      const [E, N, i, t] = pointAt(P, cum, d), [E2, N2] = pointAt(P, cum, d + 0.5);
      const y = H[i] + (H[i + 1] - H[i]) * t, a = enuToXR(E, N, getHead()), b = enuToXR(E2, N2, getHead());
      // chevron lies flat pointing to −z; turn the group so −z follows the route
      const m = new THREE.Mesh(chevGeo, blue); m.rotation.x = -Math.PI / 2;
      const grp = new THREE.Group(); grp.position.set(a.x, y + 0.02, a.z); grp.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z)); grp.add(m); root.add(grp); arrows.push({ g: grp, d });
    }
    route.steps.forEach((s, i) => {
      const d = i === 0 ? 0 : route.stepEnd[i - 1]; if (!(d > 2)) return;
      const [E, N, k, t] = pointAt(P, cum, d), y = H[k] + (H[k + 1] - H[k]) * t, a = enuToXR(E, N, getHead());
      const sp = label(`${iconFor(s.t)} ${String(s.t).slice(0, 48)}`); sp.position.set(a.x, y + 2.3, a.z); root.add(sp); arrows.push({ g: sp, d, sign: true });
    });
    const [E, N] = P[P.length - 1], a = enuToXR(E, N, getHead()), y = H[H.length - 1];
    const pin = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 4), yellow); pin.rotation.x = Math.PI; pin.position.set(a.x, y + 1.6, a.z); root.add(pin);
    const dl = label(route.dest ? route.dest.name : 'Destination', '#F3C531'); dl.position.set(a.x, y + 2.6, a.z); root.add(dl); arrows.push({ g: pin, d: total }, { g: dl, d: total });
  }
  return { scene, camera, root, arrows, build };
}

// ---------- full AR (WebXR) ----------
async function runXR(THREE, el, route, head0, close) {
  const F = enuFrame(route.line[0][0], route.line[0][1]);
  const P = route.line.map((q) => F.to(q[0], q[1])), H = route.h || P.map(() => 0), cum = cumLen(P), total = cum[cum.length - 1];
  let head = head0;
  const overlay = document.createElement('div'); overlay.className = 'ar-overlay'; el.innerHTML = ''; el.appendChild(overlay);
  const session = await navigator.xr.requestSession('immersive-ar', { requiredFeatures: ['local-floor'], optionalFeatures: ['dom-overlay'], domOverlay: { root: overlay } });
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1); renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor');
  el.appendChild(renderer.domElement); renderer.domElement.className = 'ar-canvas';
  const { scene, camera, arrows, build } = arScene(THREE, route, P, H, cum, total, () => head);
  build();
  const ui = hud(overlay, route, (dd) => { head = norm(head + dd); build(); }, () => session.end());
  let floorSeen = false, lastI = -1;
  renderer.setAnimationLoop((t, frame) => {
    const cam = renderer.xr.getCamera(camera), p = new THREE.Vector3(); cam.getWorldPosition(p);
    if (frame && !floorSeen) { const pose = frame.getViewerPose(renderer.xr.getReferenceSpace()); if (pose) floorSeen = true; }
    const w = xrToENU(p.x, p.z, head), pr = projectENU(P, cum, [w.E, w.N]);
    arrows.forEach((a) => { a.g.visible = a.sign ? a.d > pr.d + 4 && a.d < pr.d + 45 : a.d > pr.d - 3 && a.d < pr.d + 45; });
    if (floorSeen && t - lastI > 250) { lastI = t; const g = progressText(route, pr.d, pr.off); ui.set(g.t, g.s, g.ic); }
    renderer.render(scene, camera);
  });
  session.addEventListener('end', () => { renderer.setAnimationLoop(null); renderer.dispose(); close(); });
  await renderer.xr.setSession(session);
}

// ---------- preview on this screen (any device): the same floor arrows, walking the route by itself ----------
async function runPreview(THREE, el, route, head, close) {
  const F = enuFrame(route.line[0][0], route.line[0][1]);
  const P = route.line.map((q) => F.to(q[0], q[1])), H = route.h || P.map(() => 0), cum = cumLen(P), total = cum[cum.length - 1];
  el.innerHTML = '<canvas class="ar-canvas"></canvas><div class="ar-overlay"></div><div class="ar-sim">Preview · on a phone the camera picture is behind the arrows</div>';
  const canvas = el.querySelector('canvas'), overlay = el.querySelector('.ar-overlay');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(window.devicePixelRatio || 1);
  const { scene, camera, arrows, build } = arScene(THREE, route, P, H, cum, total, () => head);
  build();
  scene.background = new THREE.Color(0xdfe5ea); scene.fog = new THREE.Fog(0xdfe5ea, 25, 70);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshLambertMaterial({ color: 0xbfc5c9 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; scene.add(floor);
  const grid = new THREE.GridHelper(2000, 1000, 0x9aa3ab, 0xaab2b9); grid.position.y = 0; scene.add(grid);
  let d = 0, playing = true, speed = 2.2, last = performance.now(), raf = 0;
  const ui = hud(overlay, route, (dd) => { head = norm(head + dd); build(); }, stop, '<button class="btn sm primary" type="button" id="arPlay">⏸ Pause</button>');
  overlay.querySelector('#arPlay').onclick = (e) => { playing = !playing; e.target.textContent = playing ? '⏸ Pause' : '▶ Walk'; if (playing && d >= total - 0.2) d = 0; };
  function size() { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = 65; camera.updateProjectionMatrix(); }
  window.addEventListener('resize', size); size();
  let tUi = 0;
  function loop(now) {
    raf = requestAnimationFrame(loop); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (playing) { d = Math.min(total, d + dt * speed); if (d >= total) playing = false; }
    const [E, N, i, t] = pointAt(P, cum, d), [E2, N2, i2, t2] = pointAt(P, cum, d + 6);
    const y = H[i] + (H[i + 1] - H[i]) * t, y2 = H[i2] + (H[i2 + 1] - H[i2]) * t2, a = enuToXR(E, N, head), b = enuToXR(E2, N2, head);
    camera.position.set(a.x, y + 1.55, a.z); camera.lookAt(b.x, y2 + 0.35, b.z);
    arrows.forEach((q) => { q.g.visible = q.sign ? q.d > d + 4 && q.d < d + 45 : q.d > d - 3 && q.d < d + 45; });
    if (now - tUi > 250) { tUi = now; const g = progressText(route, d, 0); ui.set(g.t, g.s, g.ic); }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  function stop() { cancelAnimationFrame(raf); window.removeEventListener('resize', size); renderer.dispose(); close(); }
}

// ---------- camera + compass (iPhone and phones without WebXR) ----------
async function runCompass(THREE, el, route, head0, close) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); }
  catch { throw new Error('The camera is needed for AR. Allow camera access in the browser settings and try again.'); }
  const F = enuFrame(route.line[0][0], route.line[0][1]);
  const P = route.line.map((q) => F.to(q[0], q[1])), cum = cumLen(P);
  el.innerHTML = `<video class="ar-video" playsinline muted autoplay></video><canvas class="ar-canvas"></canvas><div class="ar-overlay"></div>`;
  const video = el.querySelector('video'), canvas = el.querySelector('canvas'), overlay = el.querySelector('.ar-overlay');
  video.srcObject = stream; try { await video.play(); } catch { }
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true }); renderer.setPixelRatio(window.devicePixelRatio || 1);
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
  // a big arrow floating ahead, pointing along the route
  const arrow = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color: 0x1a73e8, emissive: 0x0b3d91 });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 1.1), mat); shaft.position.z = 0.35;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.75, 24), mat); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.45;
  arrow.add(shaft, tip); arrow.scale.setScalar(0.55); const holder = new THREE.Group(); holder.position.set(0, -1.05, -3.6); holder.rotation.x = 0.55; holder.add(arrow); scene.add(holder);
  const turn = document.createElement('div'); turn.className = 'ar-turn'; turn.hidden = true; turn.textContent = '↶ Turn around · पीछे मुड़ें'; el.appendChild(turn);
  let heading = null, offset = 0, d = 0, manual = false, gpsOff = 0, watch = null, gotGps = false;
  const onOri = (e) => { const h = headingFrom(e); if (h != null) heading = h; };
  window.addEventListener('deviceorientationabsolute', onOri); window.addEventListener('deviceorientation', onOri);
  if (navigator.geolocation) watch = navigator.geolocation.watchPosition((pos) => {
    const c = pos.coords; if (manual || c.accuracy > 35) return; gotGps = true;
    const q = F.to(c.latitude, c.longitude), pr = projectENU(P, cum, q); d = Math.max(d - 15, pr.d); gpsOff = pr.off;
  }, () => { }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
  const stepIdx = () => { let i = route.stepEnd.findIndex((e) => e > d + 3); return i < 0 ? route.steps.length - 1 : i; };
  const ui = hud(overlay, route, (dd) => { offset += dd; }, stop, '<button class="btn sm primary" type="button" id="arNext">Next step ▸</button>');
  overlay.querySelector('#arNext').onclick = () => { manual = true; const i = stepIdx(); d = Math.min(cum[cum.length - 1], (route.stepEnd[i] || 0) + 0.5); };
  let raf = 0;
  function size() { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
  window.addEventListener('resize', size); size();
  function loop() {
    raf = requestAnimationFrame(loop);
    const [E, N] = pointAt(P, cum, d), [E2, N2] = pointAt(P, cum, d + 12);
    const bearing = norm(deg(Math.atan2(E2 - E, N2 - N)));
    const h = heading == null ? head0 : heading, rel = rad(norm(bearing - h - offset + 180) - 180);
    arrow.rotation.y = -rel; holder.position.x = Math.sin(rel) * 0.5; turn.hidden = Math.abs(rel) < rad(115);
    const g = progressText(route, d, gotGps ? gpsOff : 0);
    ui.set(g.t, heading == null ? 'Compass not available: turn until the arrow points along the station signs.' : g.s, g.ic);
    renderer.render(scene, camera);
  }
  loop();
  function stop() {
    cancelAnimationFrame(raf); window.removeEventListener('resize', size);
    window.removeEventListener('deviceorientationabsolute', onOri); window.removeEventListener('deviceorientation', onOri);
    if (watch != null) navigator.geolocation.clearWatch(watch);
    stream.getTracks().forEach((t) => t.stop()); renderer.dispose(); close();
  }
}
