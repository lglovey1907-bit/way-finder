'use client';
import { useState } from 'react';

export default function Staff() {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: pw }) });
      if (r.ok) { const n = new URLSearchParams(location.search).get('next'); location.href = n && n.startsWith('/') && !n.startsWith('//') ? n : '/#facilities'; return; }
      setMsg(r.status === 401 ? 'That password is not right. Try again.' : await r.text());
    } catch { setMsg('No connection. Check your network and try again.'); }
    setBusy(false);
  }
  return (
    <main className="wrap" style={{ maxWidth: 420, paddingBlock: 48 }}>
      <div className="brand" style={{ marginBottom: 24 }}>
        <span className="code">NDLS</span>
        <div><h1>Admin sign-in</h1><small>Commercial Branch · Delhi Division</small></div>
      </div>
      <form className="panel form" onSubmit={submit}>
        <div className="field">
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus required />
          <small>The office admin password. It can update facilities, QR points, photos, the station layout and the site survey, and manage staff accounts in the Control room.</small>
        </div>
        <div className="actions">
          <button className="btn primary" type="submit" disabled={busy || !pw}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <a className="btn" href="/">Back to passenger view</a>
        </div>
        <p className="msg" style={{ margin: 0 }}>Station staff with a PF number and PIN: open the <a href="/control">Control room</a> or scan your gate QR.</p>
        {msg ? <p className="msg err" role="status">{msg}</p> : null}
      </form>
    </main>
  );
}
