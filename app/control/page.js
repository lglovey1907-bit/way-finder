'use client';
// Control room: gate board (with away alert), duty log, Tell us inbox, staff accounts and settings.
import { useEffect, useMemo, useState } from 'react';
import { api, Brand, fmtTime, fmtDate, fmtMin } from '@/lib/client';
import StaffSignIn from '@/components/StaffSignIn';

const FLAG = { far: 'Far from gate', 'no-gps': 'No location', 'new-device': 'Other phone', 'other-gate': 'Other gate', 'late-photo': 'Photo time', moved: 'Moved' };
const ACT = { join: 'Joined', leave: 'Left', rejoin: 'Rejoined', end: 'Ended duty' };
const STATUS = { new: 'Received', progress: 'Being looked into', resolved: 'Resolved' };
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);

function Flags({ list }) { return (list || []).filter((f) => FLAG[f] && f !== 'moved').map((f) => <span key={f} className="xflag">{FLAG[f]}</span>); }

function Lightbox({ pics, onClose }) {
  if (!pics) return null;
  return (
    <div className="sheet" style={{ placeItems: 'center' }} onClick={onClose}>
      <div className="sheet-card wide" onClick={(e) => e.stopPropagation()}>
        <h3>{pics.title}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: pics.ref ? '1fr 1fr' : '1fr', gap: 10 }}>
          <figure style={{ margin: 0 }}><img className="xbig-img" style={{ width: '100%' }} src={pics.photo} alt="" /><figcaption className="msg">{pics.cap || 'Photo'}</figcaption></figure>
          {pics.ref ? <figure style={{ margin: 0 }}><img className="xbig-img" style={{ width: '100%' }} src={pics.ref} alt="" /><figcaption className="msg">Reference photo (taken at setup)</figcaption></figure> : null}
        </div>
        <button className="btn sheet-close" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// ---------------- Gate board ----------------
function Board({ show }) {
  const [b, setB] = useState(null);
  const [err, setErr] = useState('');
  const [only, setOnly] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () => api('/api/duty/board').then((d) => { if (live) { setB(d); setErr(''); } }).catch((e) => live && setErr(e.message));
    load(); const t = setInterval(load, 20000);
    return () => { live = false; clearInterval(t); };
  }, []);
  useEffect(() => {
    const n = b ? b.alerts.over.length : 0;
    document.title = (n ? `(${n}) ⚠ ` : '') + 'Control room · NDLS';
  }, [b]);
  if (!b) return <p className="msg">{err || 'Loading gate board…'}</p>;
  const order = { over: 0, away: 1, empty: 2, manned: 3 };
  const gates = b.gates.filter((g) => !only || g.status !== 'manned').sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name, 'en', { numeric: true }));
  const c = (s) => b.gates.filter((g) => g.status === s).length;
  const P = (p, away) => (
    <div className="xp" key={p.user}>
      <img src={p.photo} alt="" onClick={() => show({ title: `${p.name} · ${away ? 'left' : 'on duty'} ${fmtTime(p.since)}`, photo: p.photo, ref: p.ref, cap: 'Latest duty photo' })} />
      <div>
        <b>{p.name}</b> <span className="msg">PF {p.pf}</span>
        {away ? <small style={{ color: p.over ? 'var(--bad)' : 'var(--warn)', fontWeight: 600 }}>Away {fmtMin(p.min)} · {p.reason}{p.note ? ' — ' + p.note : ''}</small>
          : <small>Since {fmtTime(p.since)}{p.long ? ' · on duty over 12 h, check if they forgot to end duty' : ''}</small>}
        <Flags list={p.flags} />
      </div>
    </div>
  );
  return (
    <>
      {b.alerts.over.length ? (
        <div className="xalert" role="alert">
          <b>⚠ {b.alerts.over.length} away from the gate for more than {b.config.awayMin} minutes</b>
          {b.alerts.over.map((p) => <div key={p.user} className="msg" style={{ color: 'var(--ink)' }}>{p.name} (PF {p.pf}) · {p.gateName} · away {fmtMin(p.min)} · {p.reason}{p.mobile ? ' · ' + p.mobile : ''}</div>)}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <span className="msg"><b style={{ color: 'var(--ok)' }}>{c('manned')}</b> manned · <b style={{ color: 'var(--warn)' }}>{c('away') + c('over')}</b> staff away · <b>{c('empty')}</b> no staff · updated {fmtTime(b.at)}</span>
        <label className="msg" style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} /> Only gates needing attention</label>
      </div>
      <div className="xgates">
        {gates.map((g) => (
          <div key={g.id} className={'xgate ' + g.status}>
            <h4><span>{g.name}</span><span className="st">{g.status === 'manned' ? 'Manned' : g.status === 'empty' ? 'No staff' : g.status === 'over' ? 'Unmanned ⚠' : 'Unmanned'}</span></h4>
            {g.on.map((p) => P(p, false))}
            {g.away.map((p) => P(p, true))}
            {!g.on.length && !g.away.length ? <p className="msg" style={{ margin: '6px 0 0' }}>Nobody has scanned in here.</p> : null}
          </div>
        ))}
      </div>
      {b.alerts.flagged.length ? (
        <section className="panel" style={{ marginTop: 16 }}>
          <p className="label">Scans to check today <span className="hi">far from the gate or from another phone</span></p>
          {b.alerts.flagged.map((e) => (
            <div className="xp" key={e.id}><img src={e.photo} alt="" onClick={() => show({ title: `${e.name} · ${ACT[e.action]} ${e.gateName}`, photo: e.photo })} />
              <div><b>{e.name}</b> · {ACT[e.action]} {e.gateName} · {fmtTime(e.at)} {e.dist != null ? `· ${e.dist} m from gate` : ''} <Flags list={e.flags} /></div></div>
          ))}
        </section>
      ) : null}
    </>
  );
}

// ---------------- Duty log ----------------
function DutyLog({ show }) {
  const [day, setDay] = useState(istToday());
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [at, setAt] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => api('/api/duty/log?day=' + day).then((r) => { if (live) { setD(r); setErr(''); setAt(new Date().toISOString()); } }).catch((e) => live && setErr(e.message));
    setD(null); load();
    // Today's log keeps itself up to date; past days don't change.
    const t = day === istToday() ? setInterval(load, 30000) : null;
    return () => { live = false; if (t) clearInterval(t); };
  }, [day]);
  function csv() {
    const rows = [['Time', 'Name', 'PF', 'Gate', 'Action', 'Reason', 'Details', 'Away (min)', 'Distance (m)', 'Checks']];
    d.events.forEach((e) => rows.push([fmtTime(e.at), e.name, e.pf, e.gateName, ACT[e.action], e.reasonText, e.note, e.awayMin || '', e.dist ?? '', (e.flags || []).map((f) => FLAG[f]).join('; ')]));
    const s = '﻿' + rows.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv' })); a.download = `gate-duty-${day}.csv`; a.click();
  }
  return (
    <>
      <div className="xrow" style={{ marginBottom: 12 }}>
        <div className="field" style={{ flex: '0 1 200px' }}><label htmlFor="day">Day</label><input id="day" type="date" value={day} max={istToday()} onChange={(e) => setDay(e.target.value)} /></div>
        <button className="btn" disabled={!d || !d.events.length} onClick={csv}>Download for Excel (CSV)</button>
        {at ? <span className="msg">Updated {fmtTime(at)}{day === istToday() ? ' · refreshes every 30 s' : ''}</span> : null}
      </div>
      {!d ? <p className="msg">{err || 'Loading…'}</p> : !d.events.length ? <p className="empty">No gate duty scans on {fmtDate(day + 'T12:00:00+05:30')}.</p> : (
        <>
          <section className="panel xscroll" style={{ marginBottom: 14 }}>
            <p className="label">Per person <span className="hi">most time away first</span></p>
            <table className="xtable"><thead><tr><th>Name</th><th>Gates</th><th>Times left</th><th>Time away</th><th>Reasons</th><th>Checks</th></tr></thead>
              <tbody>{d.summary.map((s) => (
                <tr key={s.user}><td><b>{s.name}</b><br /><span className="msg">PF {s.pf}</span></td><td>{s.gates.join(', ')}</td><td>{s.leaves}</td>
                  <td>{fmtMin(s.awayMin)}{s.awayNow ? <><br /><span className="xflag">away now</span></> : null}</td>
                  <td>{Object.entries(s.reasons).map(([r, n]) => `${r} ×${n}`).join(', ')}</td><td>{s.flags ? <span className="xflag">{s.flags}</span> : '—'}</td></tr>
              ))}</tbody></table>
          </section>
          <section className="panel xscroll">
            <p className="label">Every scan <span className="hi">{d.events.length}</span></p>
            <table className="xtable"><thead><tr><th>Time</th><th>Photo</th><th>Name</th><th>Gate</th><th>Action</th><th>Reason / details</th><th>Location</th></tr></thead>
              <tbody>{d.events.map((e) => {
                const ref = (d.summary.find((s) => s.user === e.user) || {}).ref;
                return (
                  <tr key={e.id}><td>{fmtTime(e.at)}</td>
                    <td><img src={e.photo} alt="" onClick={() => show({ title: `${e.name} · ${ACT[e.action]} ${e.gateName} · ${fmtTime(e.at)}`, photo: e.photo, ref, cap: 'Photo at this scan' })} /></td>
                    <td>{e.name}<br /><span className="msg">PF {e.pf}</span></td><td>{e.gateName}</td>
                    <td>{ACT[e.action]}{e.awayMin ? <><br /><span className="msg">after {fmtMin(e.awayMin)}</span></> : null}</td>
                    <td>{e.reasonText}{e.note ? <><br /><span className="msg">{e.note}</span></> : null}</td>
                    <td>{e.dist != null ? `${e.dist} m` : '—'} <Flags list={e.flags} /></td></tr>
                );
              })}</tbody></table>
          </section>
        </>
      )}
    </>
  );
}

// ---------------- Tell us inbox ----------------
function Inbox({ me, show }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ status: 'open', cat: '', days: 30 });
  const [users, setUsers] = useState([]);
  const load = () => api('/api/fb/list?days=' + f.days).then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [f.days]);
  useEffect(() => { api('/api/u/users').then((r) => setUsers(r.users.filter((u) => u.active !== false))).catch(() => {}); }, []);
  if (!d) return <p className="msg">{err || 'Loading…'}</p>;
  const items = d.items.filter((x) => (f.status === 'all' || (f.status === 'open' ? x.status !== 'resolved' : x.status === f.status)) && (!f.cat || x.cat === f.cat));
  const places = Object.entries(d.items.filter((x) => x.status !== 'resolved').reduce((m, x) => ((m[x.place] = (m[x.place] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  return (
    <>
      <div className="xrow" style={{ marginBottom: 12 }}>
        <div className="field"><label>Show</label><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="open">Not resolved</option><option value="new">Received (new)</option><option value="progress">Being looked into</option><option value="resolved">Resolved</option><option value="all">All</option></select></div>
        <div className="field"><label>About</label><select value={f.cat} onChange={(e) => setF({ ...f, cat: e.target.value })}>
          <option value="">Everything I handle</option>{me.cats.filter(([k]) => d.scope.includes('*') || d.scope.includes(k)).map(([k, en]) => <option key={k} value={k}>{en}</option>)}</select></div>
        <div className="field"><label>Period</label><select value={f.days} onChange={(e) => setF({ ...f, days: +e.target.value })}>
          <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last year</option></select></div>
      </div>
      {places.length ? <p className="msg">Most open messages: {places.map(([p, n]) => `${p} (${n})`).join(' · ')}</p> : null}
      {!items.length ? <p className="empty">Nothing here.</p> : <div style={{ display: 'grid', gap: 10 }}>{items.map((x) => <FbItem key={x.id} x={x} users={users} show={show} onSaved={load} />)}</div>}
    </>
  );
}
function FbItem({ x, users, show, onSaved }) {
  const [e, setE] = useState({ status: x.status, remark: '', pub: true, assign: x.assign || '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  async function save() {
    setBusy(true); setMsg('');
    const body = { remark: e.remark, public: e.pub };
    if (e.status !== x.status) body.status = e.status;
    if ((e.assign || '') !== (x.assign || '')) body.assign = e.assign || null;
    try { await api('/api/fb/' + encodeURIComponent(x.id), { method: 'PUT', json: body }); setE({ ...e, remark: '' }); onSaved(); }
    catch (er) { setMsg(er.message); }
    setBusy(false);
  }
  return (
    <article className="xfb">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <b>{x.catText} · {x.place}</b><span className={'xst ' + x.status}>{STATUS[x.status]}</span>
      </div>
      <div className="meta"><span>{x.ref}</span><span>{fmtDate(x.at)} {fmtTime(x.at)}</span>{x.mobile ? <a href={'tel:' + x.mobile}>{x.mobile}</a> : <span>no mobile</span>}{x.assignName ? <span>Forwarded to {x.assignName}</span> : null}</div>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{x.text}</p>
      {x.photo ? <img src={x.photo} alt="Passenger photo" onClick={() => show({ title: x.catText + ' · ' + x.place, photo: x.photo, cap: 'Photo from passenger' })} /> : null}
      {x.log && x.log.length > 1 ? <ul className="xlog">{x.log.slice(1).map((l, i) => <li key={i}>{fmtDate(l.at)} {fmtTime(l.at)} · {l.by}{l.status ? ' → ' + STATUS[l.status] : ''}{l.assign ? ' · forwarded to ' + l.assign : ''}{l.remark ? ': ' + l.remark : ''}{l.public ? ' (shown to passenger)' : ''}</li>)}</ul> : null}
      <div className="xrow">
        <div className="field"><label>Status</label><select value={e.status} onChange={(v) => setE({ ...e, status: v.target.value })}>{Object.entries(STATUS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="field"><label>Forward to</label><select value={e.assign} onChange={(v) => setE({ ...e, assign: v.target.value })}><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.desig ? ' · ' + u.desig : ''}</option>)}</select></div>
      </div>
      <div className="field"><label>Remark / action taken</label><textarea rows={2} value={e.remark} onChange={(v) => setE({ ...e, remark: v.target.value })} /></div>
      <div className="actions">
        <label className="msg" style={{ display: 'flex', gap: 6 }}><input type="checkbox" checked={e.pub} onChange={(v) => setE({ ...e, pub: v.target.checked })} /> Show this remark to the passenger</label>
        <button className="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        {msg ? <span className="msg err">{msg}</span> : null}
      </div>
    </article>
  );
}

// ---------------- Staff accounts & settings ----------------
const blank = { name: '', pf: '', desig: '', mobile: '', perms: { duty: true, board: false, staff: false, fb: [] } };
function Perms({ p, cats, onChange }) {
  const fb = p.fb || [], all = fb.includes('*');
  const tog = (k) => onChange({ ...p, [k]: !p[k] });
  const togFb = (k) => onChange({ ...p, fb: fb.includes(k) ? fb.filter((x) => x !== k) : [...fb.filter((x) => x !== '*'), k] });
  return (
    <div className="form" style={{ gap: 8 }}>
      <div className="xchecks">
        <label><input type="checkbox" checked={!!p.duty} onChange={() => tog('duty')} /> Gate duty (ticket checking)</label>
        <label><input type="checkbox" checked={!!p.board} onChange={() => tog('board')} /> See gate board &amp; duty log</label>
        <label><input type="checkbox" checked={!!p.staff} onChange={() => tog('staff')} /> Manage staff &amp; settings</label>
      </div>
      <div><span className="flabel">Handles Tell us about</span>
        <div className="xchecks" style={{ marginTop: 4 }}>
          <label><input type="checkbox" checked={all} onChange={() => onChange({ ...p, fb: all ? [] : ['*'] })} /> Everything</label>
          {!all ? cats.map(([k, en]) => <label key={k}><input type="checkbox" checked={fb.includes(k)} onChange={() => togFb(k)} /> {en}</label>) : null}
        </div></div>
    </div>
  );
}
function Staff({ me }) {
  const [list, setList] = useState(null);
  const [n, setN] = useState(blank);
  const [code, setCode] = useState(null);
  const [edit, setEdit] = useState(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const load = () => api('/api/u/users').then((r) => setList(r.users)).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);
  async function add(e) {
    e.preventDefault(); setMsg('');
    try { const r = await api('/api/u/users', { json: n }); setCode({ name: r.user.name, pf: r.user.pf, code: r.code }); setN(blank); load(); window.scrollTo(0, 0); }
    catch (er) { setMsg(er.message); }
  }
  async function upd(id, body) {
    setMsg('');
    try { const r = await api('/api/u/users/' + encodeURIComponent(id), { method: 'PUT', json: body }); if (r.code) { setCode({ name: r.user.name, pf: r.user.pf, code: r.code }); window.scrollTo(0, 0); } setEdit(null); load(); }
    catch (er) { setMsg(er.message); }
  }
  const shown = (list || []).filter((u) => !q || (u.name + ' ' + u.pf + ' ' + u.desig).toLowerCase().includes(q.toLowerCase()));
  const permText = (p) => [p.duty && 'Gate duty', p.board && 'Gate board', p.staff && 'Manage staff', (p.fb || []).length && ('Tell us: ' + ((p.fb || []).includes('*') ? 'all' : p.fb.map((k) => (me.cats.find((c) => c[0] === k) || [k, k])[1]).join(', ')))].filter(Boolean).join(' · ') || 'No access';
  return (
    <>
      {code ? (
        <div className="xalert" style={{ borderColor: 'var(--ok)', background: 'color-mix(in srgb,var(--ok) 10%,var(--surface))' }}>
          <b style={{ color: 'var(--ok)' }}>Setup code for {code.name} (PF {code.pf})</b>
          <div className="xcode">{code.code}</div>
          <p className="msg" style={{ margin: 0 }}>Give this code to {code.name} privately. It works once, for 7 days. They scan any gate QR → Railway staff: gate duty → <b>First time</b>, choose their own PIN and take their photo. This code is not shown again.</p>
          <button className="btn sm" style={{ marginTop: 6 }} onClick={() => setCode(null)}>Done</button>
        </div>
      ) : null}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        <section className="panel">
          <p className="label">Add a staff member</p>
          <form className="form" onSubmit={add}>
            <div className="xrow">
              <div className="field"><label>Name</label><input value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} required /></div>
              <div className="field"><label>PF / HRMS number</label><input value={n.pf} onChange={(e) => setN({ ...n, pf: e.target.value })} required /></div>
              <div className="field"><label>Designation</label><input value={n.desig} onChange={(e) => setN({ ...n, desig: e.target.value })} placeholder="TTE, CTI, CHI, CMI…" /></div>
              <div className="field"><label>Mobile</label><input value={n.mobile} type="tel" onChange={(e) => setN({ ...n, mobile: e.target.value })} /></div>
            </div>
            <Perms p={n.perms} cats={me.cats} onChange={(p) => setN({ ...n, perms: p })} />
            <div className="actions"><button className="btn primary" type="submit">Add and get setup code</button></div>
          </form>
          {msg ? <p className="msg err">{msg}</p> : null}
        </section>
        <section className="panel xscroll">
          <div className="xrow" style={{ marginBottom: 8 }}><p className="label" style={{ flex: 1 }}>Staff accounts <span className="hi">{list ? list.length : ''}</span></p>
            <div className="field" style={{ flex: '0 1 220px' }}><input placeholder="Search name or PF" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
          {!list ? <p className="msg">Loading…</p> : (
            <table className="xtable"><thead><tr><th></th><th>Name</th><th>Access</th><th>Status</th><th></th></tr></thead>
              <tbody>{shown.map((u) => edit && edit.id === u.id ? (
                <tr key={u.id}><td colSpan={5}>
                  <div className="xrow" style={{ marginBottom: 8 }}>
                    <div className="field"><label>Name</label><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
                    <div className="field"><label>Designation</label><input value={edit.desig} onChange={(e) => setEdit({ ...edit, desig: e.target.value })} /></div>
                    <div className="field"><label>Mobile</label><input value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} /></div>
                  </div>
                  <Perms p={edit.perms} cats={me.cats} onChange={(p) => setEdit({ ...edit, perms: p })} />
                  <div className="actions" style={{ marginTop: 8 }}>
                    <button className="btn primary sm" onClick={() => upd(u.id, { name: edit.name, desig: edit.desig, mobile: edit.mobile, perms: edit.perms })}>Save</button>
                    <button className="btn sm" onClick={() => setEdit(null)}>Cancel</button>
                    <button className="btn sm" onClick={() => confirm(`Give ${u.name} a new setup code? Their PIN and photo will need to be set again, and they are signed out.`) && upd(u.id, { reset: true })}>Reset PIN &amp; photo</button>
                    <button className="btn sm danger" onClick={() => upd(u.id, { active: !u.active })}>{u.active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </td></tr>
              ) : (
                <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
                  <td>{u.refPhoto ? <img src={'/api/pfile?k=' + encodeURIComponent(u.refPhoto)} alt="" /> : null}</td>
                  <td><b>{u.name}</b><br /><span className="msg">PF {u.pf}{u.desig ? ' · ' + u.desig : ''}{u.mobile ? ' · ' + u.mobile : ''}</span></td>
                  <td style={{ maxWidth: 380 }}>{permText(u.perms)}</td>
                  <td>{!u.active ? 'Deactivated' : u.ready ? 'Ready' : <span className="xflag">Setup pending</span>}</td>
                  <td><button className="btn sm" onClick={() => setEdit({ id: u.id, name: u.name, desig: u.desig, mobile: u.mobile, perms: { ...u.perms } })}>Edit</button></td>
                </tr>
              ))}</tbody></table>
          )}
        </section>
        <Settings me={me} />
      </div>
    </>
  );
}
function Settings({ me }) {
  const [c, setC] = useState(me.config);
  const [pts, setPts] = useState([]);
  const [msg, setMsg] = useState('');
  useEffect(() => { api('/api/data').then((d) => setPts(Object.entries(d.qrpoints || {}).map(([id, p]) => ({ id, ...p })).sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })))).catch(() => {}); }, []);
  const watched = (p) => (c.watch && c.watch[p.id] != null ? c.watch[p.id] : p.kind === 'Gate');
  async function save() {
    setMsg('');
    try { const r = await api('/api/duty/config', { method: 'PUT', json: { awayMin: c.awayMin, radius: c.radius, watch: c.watch || {} } }); setC(r.config); setMsg('Saved.'); }
    catch (e) { setMsg(e.message); }
  }
  return (
    <section className="panel form">
      <p className="label">Gate duty settings</p>
      <div className="xrow">
        <div className="field"><label>Alert when away for (minutes)</label><input type="number" min={1} max={240} value={c.awayMin} onChange={(e) => setC({ ...c, awayMin: e.target.value })} /></div>
        <div className="field"><label>Must be within (metres) of the gate</label><input type="number" min={20} max={1000} value={c.radius} onChange={(e) => setC({ ...c, radius: e.target.value })} />
          <small>Scans further away are saved but marked “Far from gate”. The gate’s position comes from its QR point.</small></div>
      </div>
      <div><span className="flabel">Show on the gate board</span>
        <div className="xchecks" style={{ marginTop: 4 }}>{pts.map((p) => (
          <label key={p.id}><input type="checkbox" checked={watched(p)} onChange={() => setC({ ...c, watch: { ...(c.watch || {}), [p.id]: !watched(p) } })} /> {p.name}{typeof p.lat !== 'number' ? ' (no GPS)' : ''}</label>
        ))}</div></div>
      <div className="actions"><button className="btn primary" onClick={save}>Save settings</button>{msg ? <span className="msg">{msg}</span> : null}</div>
    </section>
  );
}

// ---------------- feature switches ----------------
function Features({ feat, onChange }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  async function flip(k) {
    setBusy(k); setMsg('');
    try { const r = await api('/api/features', { method: 'PUT', json: { [k]: !feat[k] } }); onChange({ tell: r.tell, duty: r.duty }); setMsg(`${k === 'tell' ? 'Tell us' : 'Gate duty'} is now ${r[k] ? 'on' : 'off'}.`); }
    catch (e) { setMsg(e.message); }
    setBusy('');
  }
  const row = (k, title, on, off) => (
    <label className="toggle" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }}>
      <div><b>{title}</b> <span className={'xst ' + (feat[k] ? 'resolved' : 'new')}>{feat[k] ? 'On' : 'Off'}</span><br /><small className="msg">{feat[k] ? on : off}</small></div>
      <span className="sw"><input type="checkbox" checked={!!feat[k]} disabled={!!busy} onChange={() => flip(k)} aria-label={title} /><i /></span>
    </label>
  );
  return (
    <section className="panel" style={{ marginBottom: 16 }}>
      <p className="label" style={{ margin: 0 }}>Features <span className="hi">switch each one on or off</span></p>
      {row('tell', 'Tell us · हमें बताएं (passenger messages)', 'Passengers see “Tell us” after scanning a QR board and can send messages. Staff see them in the Tell us tab.', 'Hidden from passengers and staff. New messages are refused. Messages already received are kept.')}
      {row('duty', 'Gate duty (ticket checking staff)', 'Staff see “Railway staff: gate duty” after scanning a gate QR. The Gate board and Duty log tabs are shown.', 'Hidden from staff. Duty scans are refused. Past duty records are kept.')}
      {msg ? <p className="msg" role="status">{msg}</p> : null}
    </section>
  );
}

// ---------------- page ----------------
export default function Control() {
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('');
  const [pics, setPics] = useState(null);
  const [feat, setFeat] = useState({ tell: true, duty: true });
  const load = () => api('/api/u/me').then(setMe).catch(() => setMe({ signedIn: false }));
  useEffect(() => { load(); api('/api/features').then(setFeat).catch(() => {}); }, []);
  const tabs = useMemo(() => !me || !me.signedIn ? [] : [
    feat.duty && me.can.board && ['board', 'Gate board'], feat.duty && me.can.board && ['log', 'Duty log'], feat.tell && ['fb', 'Tell us'], me.can.staff && ['staff', 'Staff & settings'],
  ].filter(Boolean), [me, feat]);
  useEffect(() => {
    if (!tabs.length || tabs.find((t) => t[0] === tab)) return;
    const h = location.hash.slice(1);
    setTab(tabs.find((t) => t[0] === h) ? h : tabs[0][0]);
  }, [tabs]);
  if (!me) return <main className="xwide"><p className="msg">Loading…</p></main>;
  if (!me.signedIn) return (
    <main className="xpage"><Brand title="Control room" sub="Commercial Branch · Delhi Division" />
      <StaffSignIn onDone={load} />
      <p className="msg" style={{ marginTop: 12 }}>Office admin? <a href="/staff?next=/control">Sign in with the admin password</a>.</p></main>
  );
  return (
    <main className="xwide">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Brand title="Control room" sub={`${me.name}${me.admin ? ' · admin' : ''} · Commercial Branch · Delhi Division`} />
        <div className="actions">
          {me.admin ? <a className="btn sm" href="/#facilities">Wayfinder editing</a> : null}
          <a className="btn sm" href="/">Passenger view</a>
          {me.user ? <button className="btn sm" onClick={async () => { await api('/api/u/logout', { method: 'POST' }); load(); }}>Sign out</button> : <a className="btn sm" href="/api/logout">Sign out</a>}
        </div>
      </div>
      <nav className="xtabs" role="tablist">
        {tabs.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); history.replaceState(null, '', '#' + k); }}>{t}</button>)}
      </nav>
      {!tabs.length ? <div className="xstate"><b>Nothing to show</b><p style={{ margin: '6px 0 0' }}>Tell us and Gate duty are switched off. Ask the office to switch them on.</p></div> : null}
      {tab === 'board' ? <Board show={setPics} /> : tab === 'log' ? <DutyLog show={setPics} /> : tab === 'fb' ? <Inbox me={me} show={setPics} /> : tab === 'staff' ? <><Features feat={feat} onChange={setFeat} /><Staff me={me} /></> : null}
      <Lightbox pics={pics} onClose={() => setPics(null)} />
    </main>
  );
}
