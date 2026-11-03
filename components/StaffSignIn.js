'use client';
// PF number + own PIN. First time: PF + setup code from the office → choose PIN → reference photo.
import { useState } from 'react';
import { api, deviceId, LiveCamera } from '@/lib/client';

export default function StaffSignIn({ onDone, intro }) {
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ pf: '', pin: '', code: '', pin2: '' });
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function login(e) {
    e.preventDefault(); setMsg(''); setBusy(true);
    try { await api('/api/u/login', { json: { pf: f.pf, pin: f.pin, device: deviceId() } }); onDone(); }
    catch (er) { setMsg(er.message); }
    setBusy(false);
  }
  function next(e) {
    e.preventDefault(); setMsg('');
    if (!/^\d{4,6}$/.test(f.pin)) return setMsg('PIN must be 4 to 6 digits.');
    if (f.pin !== f.pin2) return setMsg('The two PINs are not the same.');
    setStep(2);
  }
  async function finish(blob) {
    setMsg(''); setBusy(true);
    const fd = new FormData();
    fd.set('pf', f.pf); fd.set('code', f.code); fd.set('pin', f.pin); fd.set('device', deviceId()); fd.set('photo', blob, 'me.jpg');
    try { await api('/api/u/setup', { method: 'POST', body: fd }); onDone(); }
    catch (er) { setMsg(er.message); setStep(1); }
    setBusy(false);
  }

  return (
    <section className="panel">
      <div className="xtabs" role="tablist">
        <button type="button" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setMsg(''); }}>Sign in</button>
        <button type="button" aria-selected={mode === 'setup'} onClick={() => { setMode('setup'); setStep(1); setMsg(''); }}>First time</button>
      </div>
      {intro ? <p className="msg" style={{ marginTop: 0 }}>{intro}</p> : null}
      {mode === 'login' ? (
        <form className="form" onSubmit={login}>
          <div className="field"><label htmlFor="pf">PF / HRMS number</label><input id="pf" value={f.pf} onChange={set('pf')} autoCapitalize="characters" autoComplete="username" required /></div>
          <div className="field"><label htmlFor="pin">PIN</label><input id="pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={f.pin} onChange={set('pin')} required /></div>
          <button className="btn primary xbig" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
      ) : step === 1 ? (
        <form className="form" onSubmit={next}>
          <p className="msg" style={{ margin: 0 }}>Your office gives you a 6-digit setup code. You then choose your own PIN and take a photo of your face, which is kept with your duty records.</p>
          <div className="field"><label htmlFor="spf">PF / HRMS number</label><input id="spf" value={f.pf} onChange={set('pf')} autoCapitalize="characters" required /></div>
          <div className="field"><label htmlFor="sc">Setup code from the office</label><input id="sc" inputMode="numeric" maxLength={6} value={f.code} onChange={set('code')} required /></div>
          <div className="field"><label htmlFor="np">Choose a PIN (4 to 6 digits)</label><input id="np" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={f.pin} onChange={set('pin')} required /></div>
          <div className="field"><label htmlFor="np2">Type the PIN again</label><input id="np2" type="password" inputMode="numeric" maxLength={6} autoComplete="new-password" value={f.pin2} onChange={set('pin2')} required /></div>
          <button className="btn primary xbig" type="submit">Next: your photo</button>
        </form>
      ) : (
        <div className="form">
          <p style={{ margin: 0 }}><b>Your reference photo.</b> Face the camera in good light, without cap or mask.</p>
          {busy ? <p className="msg">Saving…</p> : <LiveCamera stamp={'Reference · PF ' + f.pf.toUpperCase()} onShot={finish} label="Take my photo" />}
          <button className="btn" type="button" onClick={() => setStep(1)}>Back</button>
        </div>
      )}
      {msg ? <p className="msg err" role="status">{msg}</p> : null}
    </section>
  );
}
