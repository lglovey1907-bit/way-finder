'use client';
// Ticket checking staff: scan the gate's QR → join duty / leave the gate (with reason) / rejoin / end duty.
// Every action takes a live photo (front camera, in the app) and the phone's location.
import { useEffect, useRef, useState } from 'react';
import { api, deviceId, qrFromUrl, getLocation, LiveCamera, Brand, fmtTime, fmtMin } from '@/lib/client';
import StaffSignIn from '@/components/StaffSignIn';

const FLAG_TEXT = {
  far: 'Your location looks far from this gate. This has been noted for your supervisor.',
  'no-gps': 'Location was not available. This has been noted. Turn on location next time.',
  'new-device': 'This is not your usual phone. This has been noted.',
  'other-gate': 'You did this at a different gate from where you were on duty.',
  'late-photo': 'The photo time did not match. This has been noted.',
};
const ACTION_TEXT = { join: 'Join duty', leave: 'Leave the gate', rejoin: 'Rejoin the gate', end: 'End duty' };
const DONE_TEXT = { join: 'You are on duty', leave: 'You are marked away', rejoin: 'Welcome back. You are on duty', end: 'Duty ended' };

function DutyPage() {
  const [qr, setQr] = useState('');
  const [pt, setPt] = useState(null);
  const [me, setMe] = useState(null);
  const [step, setStep] = useState(null); // {action, reason, note, phase:'reason'|'photo'|'sending'}
  const [done, setDone] = useState(null);
  const [msg, setMsg] = useState('');
  const [, tick] = useState(0);
  const loc = useRef(null);

  const load = () => api('/api/u/me').then(setMe).catch((e) => setMsg(e.message));
  useEffect(() => {
    const id = qrFromUrl(); setQr(id);
    if (id) api('/api/data').then((d) => setPt((d.qrpoints || {})[id] ? { id, ...d.qrpoints[id] } : false)).catch(() => {});
    else setPt(false);
    load();
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, []);

  if (!me) return <main className="xpage"><Brand title="Gate duty" /><p className="msg">{msg || 'Loading…'}</p></main>;
  const gateName = pt ? pt.name : qr.toUpperCase();
  const head = (
    <div className="xhere"><div><span>Duty point · ड्यूटी स्थान</span><b>{pt ? (pt.nameHi ? `${pt.name} · ${pt.nameHi}` : pt.name) : qr ? qr.toUpperCase() : 'No QR scanned'}</b></div></div>
  );
  if (pt === false || !qr) return (
    <main className="xpage"><Brand title="Gate duty" />{head}
      <p className="msg err">Scan the QR code at your gate with the phone camera to open this page for that gate.</p></main>
  );
  if (!me.signedIn || !me.user) return (
    <main className="xpage"><Brand title="Gate duty · गेट ड्यूटी" sub="Ticket checking staff" />{head}
      <StaffSignIn onDone={load} intro="Sign in once on your own phone. After that, just scan the gate QR." /></main>
  );
  if (!me.can.duty) return (
    <main className="xpage"><Brand title="Gate duty" />{head}
      <p className="msg err">Your account ({me.name}) is not set up for gate duty. Ask your office to turn on “Gate duty”.</p>
      <p><a href="/control">Open control room</a></p></main>
  );

  const d = me.duty || { state: 'off' };
  const here = d.gate === qr;
  const away = d.state === 'away' ? Math.round((Date.now() - Date.parse(d.since)) / 60000) : 0;
  const over = d.state === 'away' && away >= (me.config.awayMin || 15);

  function start(action) {
    setMsg(''); setDone(null);
    loc.current = getLocation();
    setStep({ action, reason: '', note: '', phase: action === 'leave' ? 'reason' : 'photo' });
  }
  async function submit(blob, shotAt) {
    const cur = step;
    setStep({ ...cur, phase: 'sending' });
    const g = (await loc.current) || {};
    const fd = new FormData();
    fd.set('action', cur.action); fd.set('gate', qr); fd.set('reason', cur.reason); fd.set('note', cur.note);
    if (g.lat != null) { fd.set('lat', g.lat); fd.set('lng', g.lng); fd.set('acc', g.acc); }
    fd.set('device', deviceId()); fd.set('shotAt', shotAt); fd.set('photo', blob, 'duty.jpg');
    try {
      const r = await api('/api/duty', { method: 'POST', body: fd });
      setDone({ ...r, gpsErr: g.err }); setStep(null); await load(); window.scrollTo(0, 0);
    } catch (e) { setMsg(e.message); setStep({ ...cur, phase: 'photo' }); }
  }

  if (step) {
    const r = me.reasons || [];
    return (
      <main className="xpage"><Brand title={ACTION_TEXT[step.action]} sub={me.name + ' · PF ' + (me.user.pf || '')} />{head}
        {step.phase === 'reason' ? (
          <section className="panel form">
            <p className="label">Why are you leaving the gate? <span className="hi">गेट क्यों छोड़ रहे हैं?</span></p>
            <div className="xreasons">
              {r.map(([id, en, hi]) => (
                <label key={id}><input type="radio" name="r" checked={step.reason === id} onChange={() => setStep({ ...step, reason: id })} /><span>{en}<br /><small>{hi}</small></span></label>
              ))}
            </div>
            <div className="field">
              <label htmlFor="n">{step.reason === 'other' ? 'Write the reason (required)' : 'Details (optional)'}</label>
              <textarea id="n" rows={2} maxLength={300} value={step.note} onChange={(e) => setStep({ ...step, note: e.target.value })} placeholder="e.g. Called by CIT to booking office" />
            </div>
            <div className="actions">
              <button className="btn primary xbig" type="button" disabled={!step.reason || (step.reason === 'other' && step.note.trim().length < 3)} onClick={() => setStep({ ...step, phase: 'photo' })}>Next: photo</button>
              <button className="btn" type="button" onClick={() => setStep(null)}>Cancel</button>
            </div>
          </section>
        ) : step.phase === 'photo' ? (
          <section className="panel form">
            <p style={{ margin: 0 }}><b>Live photo.</b> Your face, taken now. It is checked against your reference photo.</p>
            <LiveCamera stamp={`${me.name} · ${gateName} · ${ACTION_TEXT[step.action]}`} onShot={submit} />
            <button className="btn" type="button" onClick={() => setStep(null)}>Cancel</button>
            {msg ? <p className="msg err" role="status">{msg}</p> : null}
          </section>
        ) : <section className="panel"><p>Saving… getting your location and uploading the photo.</p></section>}
      </main>
    );
  }

  return (
    <main className="xpage"><Brand title="Gate duty · गेट ड्यूटी" sub={me.name + (me.user.desig ? ' · ' + me.user.desig : '') + ' · PF ' + me.user.pf} />{head}
      {done ? (
        <div className="panel" style={{ marginBottom: 14 }}>
          <p style={{ margin: 0 }} className="msg okm"><b>{DONE_TEXT[done.action]}</b> · {fmtTime(done.state.since)}</p>
          {(done.flags || []).filter((f) => FLAG_TEXT[f]).map((f) => <p key={f} className="msg err" style={{ margin: '4px 0 0' }}>{FLAG_TEXT[f]}</p>)}
        </div>
      ) : null}

      {d.state === 'off' ? (
        <div className="xstate"><b>You are not on duty</b><span className="msg">Scan in when you take over this gate.</span></div>
      ) : d.state === 'on' ? (
        <div className="xstate on"><b>On duty at {d.gateName}</b><span className="msg">Since {fmtTime(d.since)}{d.joinedAt && d.joinedAt !== d.since ? ` · duty started ${fmtTime(d.joinedAt)}` : ''}</span></div>
      ) : (
        <div className={'xstate ' + (over ? 'over' : 'away')}><b>Away from {d.gateName} · {fmtMin(away)}</b>
          <span className="msg">Left at {fmtTime(d.since)} · {d.reasonText}{d.note ? ' — ' + d.note : ''}</span>
          {over ? <p className="msg err" style={{ margin: '4px 0 0' }}>Away for more than {me.config.awayMin} minutes. Your supervisor can see this.</p> : null}
        </div>
      )}

      <div className="xbtns">
        {d.state === 'off' ? <button className="btn go" onClick={() => start('join')}>Join duty at {gateName}</button> : null}
        {d.state === 'on' && here ? <>
          <button className="btn stop" onClick={() => start('leave')}>Leave the gate · गेट छोड़ें</button>
          <button className="btn" onClick={() => start('end')}>End duty · ड्यूटी समाप्त</button>
        </> : null}
        {d.state === 'on' && !here ? <>
          <p className="msg" style={{ margin: 0 }}>To leave {d.gateName}, scan the QR code at {d.gateName}. If you have been moved here, use the button below.</p>
          <button className="btn go" onClick={() => start('join')}>Move my duty to {gateName}</button>
          <button className="btn" onClick={() => start('end')}>End duty</button>
        </> : null}
        {d.state === 'away' ? <>
          <button className="btn go" onClick={() => start('rejoin')}>Rejoin {here ? 'the gate' : 'at ' + gateName} · वापस ड्यूटी पर</button>
          <button className="btn" onClick={() => start('end')}>End duty</button>
        </> : null}
      </div>
      {msg ? <p className="msg err">{msg}</p> : null}
      <p className="msg" style={{ marginTop: 20 }}>
        Signed in as {me.name}. <a href="#" onClick={async (e) => { e.preventDefault(); await api('/api/u/logout', { method: 'POST' }); load(); }}>Sign out</a>
        {me.can.board || me.can.fb || me.can.staff ? <> · <a href="/control">Control room</a></> : null}
      </p>
    </main>
  );
}

// Switched off in Control room → Staff & settings? Then this page shows a short notice instead.
export default function GateDuty() {
  const [f, setF] = useState(null);
  useEffect(() => { api('/api/features').then(setF).catch(() => setF({ tell: true, duty: true })); }, []);
  if (!f) return <main className="xpage"><Brand title="Gate duty · गेट ड्यूटी" /><p className="msg">Loading…</p></main>;
  if (!f.duty) return (
    <main className="xpage"><Brand title="Gate duty · गेट ड्यूटी" />
      <div className="xstate"><b>Not available right now · अभी उपलब्ध नहीं</b><p style={{ margin: "6px 0 0" }}>Gate duty marking has been switched off by the office.</p></div>
      <p><a className="btn" href={'/' + (typeof location !== 'undefined' ? location.hash : '')}>Back to directions · रास्ता देखें</a></p></main>
  );
  return <DutyPage />;
}
