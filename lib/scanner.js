// In-app QR scanner: camera → board ID → "You are here".
// Uses the browser's built-in BarcodeDetector where available, jsQR everywhere else.
import jsQR from 'jsqr';

export function initScanner() {
  const $ = (id) => document.getElementById(id);
  const btn = $('camBtn'), wrap = $('camWrap'), video = $('camVideo'), msg = $('camMsg'), sheet = $('sheet');
  if (!btn || btn.__wf) return;
  btn.__wf = true;
  let stream = null, timer = null, denied = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const say = (t, err) => { msg.textContent = t || ''; msg.className = 'msg' + (err ? ' err' : ''); };

  function stop() {
    clearTimeout(timer); timer = null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null; video.srcObject = null; wrap.hidden = true; btn.textContent = 'Scan with camera';
  }
  function boardId(text) {
    try { const u = new URL(text, location.href); const h = decodeURIComponent(u.hash.slice(1)); if (h) return h.toLowerCase(); } catch (e) {}
    return /^[a-z0-9][a-z0-9-]{1,40}$/i.test(text) ? text.toLowerCase() : null;
  }
  function found(text) {
    const id = boardId(text);
    if (!id) { say("That QR code isn't a station wayfinding board. Try the yellow board.", true); return false; }
    stop(); say('');
    if (navigator.vibrate) navigator.vibrate(60);
    if (location.hash.slice(1) === id) window.dispatchEvent(new HashChangeEvent('hashchange'));
    else location.hash = id;
    const c = $('sheetClose'); if (c && !sheet.hidden) c.click();
    return true;
  }
  async function start() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      say("This browser can't open the camera. Use your phone's camera app to scan the board, or pick from the list.", true); return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) {
      denied = true;
      say('Camera access was blocked. Allow the camera in your browser settings, or pick from the list.', true); return;
    }
    video.srcObject = stream; wrap.hidden = false; btn.textContent = 'Stop camera'; say('Looking for a QR code…');
    try { await video.play(); } catch (e) {}
    const det = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
    const tick = async () => {
      if (!stream) return;
      try {
        if (video.readyState >= 2) {
          if (det) {
            const codes = await det.detect(video);
            if (codes.length && found(codes[0].rawValue)) return;
          } else {
            const w = video.videoWidth, h = video.videoHeight, s = Math.min(1, 640 / Math.max(w, h));
            canvas.width = Math.round(w * s); canvas.height = Math.round(h * s);
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code && found(code.data)) return;
          }
        }
      } catch (e) {}
      timer = setTimeout(tick, 180);
    };
    tick();
  }
  btn.addEventListener('click', () => (stream ? stop() : start()));
  // Open the camera as soon as the passenger taps "Scan QR code"; close it with the sheet.
  new MutationObserver(() => {
    if (sheet.hidden) stop();
    else if (!stream && !denied) start();
  }).observe(sheet, { attributes: true, attributeFilter: ['hidden'] });
}
