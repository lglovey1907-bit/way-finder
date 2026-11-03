'use client';
// Browser helpers shared by /tell, /duty, /staff and /control.
import { useEffect, useRef, useState } from 'react';

export function deviceId() {
  try {
    let d = localStorage.getItem('wf_dev');
    if (!d) { d = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); localStorage.setItem('wf_dev', d); }
    return d;
  } catch { return ''; }
}
export async function api(url, opts = {}) {
  const o = { ...opts };
  if (o.json !== undefined) { o.body = JSON.stringify(o.json); o.headers = { 'content-type': 'application/json' }; o.method = o.method || 'POST'; delete o.json; }
  let r;
  try { r = await fetch(url, o); } catch { throw new Error('No connection. Check your network and try again.'); }
  if (!r.ok) throw new Error((await r.text()) || 'Something went wrong (' + r.status + ')');
  return r.json();
}
export const qrFromUrl = () => {
  if (typeof window === 'undefined') return '';
  const u = new URL(location.href);
  return (u.searchParams.get('p') || decodeURIComponent(u.hash.slice(1)) || '').toLowerCase();
};
export const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }) : '');
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '');
export const fmtMin = (m) => (m == null ? '' : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);

// Phone location, best effort within a few seconds.
export function getLocation(timeout = 12000) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ err: 'This phone cannot share location.' });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => resolve({ err: e.code === 1 ? 'Location is blocked. Allow location for this site in the browser settings.' : 'Could not get your location.' }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}

// Shrink a picked image to a JPEG (passenger photos).
export async function toJpeg(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  } finally { URL.revokeObjectURL(url); }
}

// Live camera: only a picture taken right now in the app (no gallery). The time and place are
// printed onto the photo. onShot(blob, isoTime) is called after the person confirms.
export function LiveCamera({ stamp, facing = 'user', onShot, label = 'Take photo' }) {
  const video = useRef(null), streamRef = useRef(null);
  const [err, setErr] = useState('');
  const [shot, setShot] = useState(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let dead = false;
    (async () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { setErr("This browser can't open the camera. Use Chrome on your phone."); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 960 }, height: { ideal: 1280 } }, audio: false });
        if (dead) { s.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = s; video.current.srcObject = s;
        await video.current.play().catch(() => {});
        setReady(true);
      } catch { setErr('Camera is blocked. Allow the camera for this site in the browser settings, then reload.'); }
    })();
    return () => { dead = true; if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop()); };
  }, [facing]);
  function take() {
    const v = video.current; if (!v || !v.videoWidth) return;
    const s = Math.min(1, 900 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * s); c.height = Math.round(v.videoHeight * s);
    const g = c.getContext('2d');
    if (facing === 'user') { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(v, 0, 0, c.width, c.height);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const at = new Date();
    const lines = [at.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'medium' }), stamp || ''].filter(Boolean);
    const fs = Math.max(16, Math.round(c.width / 28));
    g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, c.height - lines.length * fs * 1.35 - 12, c.width, lines.length * fs * 1.35 + 12);
    g.fillStyle = '#fff'; g.font = `600 ${fs}px system-ui,sans-serif`;
    lines.forEach((t, i) => g.fillText(t, 10, c.height - 10 - (lines.length - 1 - i) * fs * 1.35));
    c.toBlob((b) => setShot({ blob: b, url: URL.createObjectURL(b), at: at.toISOString() }), 'image/jpeg', 0.82);
  }
  if (err) return <p className="msg err">{err}</p>;
  return (
    <div className="xcam">
      <div className="xcam-box">
        <video ref={video} playsInline muted style={{ transform: facing === 'user' ? 'scaleX(-1)' : 'none' }} hidden={!!shot} />
        {shot ? <img src={shot.url} alt="Your photo" /> : null}
        {!ready && !shot ? <span className="xcam-wait">Opening camera…</span> : null}
      </div>
      <div className="actions" style={{ justifyContent: 'center', marginTop: 10 }}>
        {shot ? (
          <>
            <button type="button" className="btn" onClick={() => setShot(null)}>Retake</button>
            <button type="button" className="btn primary" onClick={() => onShot(shot.blob, shot.at)}>Use this photo</button>
          </>
        ) : (
          <button type="button" className="btn primary xbig" disabled={!ready} onClick={take}>{label}</button>
        )}
      </div>
    </div>
  );
}

export function Brand({ title, sub }) {
  return (
    <div className="brand" style={{ marginBottom: 18 }}>
      <span className="code">NDLS</span>
      <div><h1>{title}</h1><small>{sub || 'New Delhi Railway Station · नई दिल्ली'}</small></div>
    </div>
  );
}
