'use client';
// Passenger "Tell us" (हमें बताएं): reached from the same station QR code as directions.
import { useEffect, useState } from 'react';
import { api, qrFromUrl, toJpeg, Brand, fmtDate, fmtTime } from '@/lib/client';

const CATS = [
  ['clean', 'Cleanliness', 'साफ़-सफ़ाई'], ['toilet', 'Toilets', 'शौचालय'], ['water', 'Drinking water', 'पीने का पानी'],
  ['power', 'Lights & fans', 'लाइट और पंखे'], ['lift', 'Lift / escalator', 'लिफ्ट / एस्केलेटर'], ['staff', 'Staff behaviour', 'कर्मचारी व्यवहार'],
  ['ticket', 'Tickets', 'टिकट'], ['food', 'Food & catering', 'खान-पान'], ['safety', 'Safety & security', 'सुरक्षा'],
  ['info', 'Signs & announcements', 'सूचना एवं उद्घोषणा'], ['praise', 'Appreciation', 'प्रशंसा'], ['other', 'Something else', 'अन्य'],
];

function TellPage() {
  const [qr, setQr] = useState('');
  const [pt, setPt] = useState(null);
  const [cat, setCat] = useState('');
  const [text, setText] = useState('');
  const [mobile, setMobile] = useState('');
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [ref, setRef] = useState('');
  const [chk, setChk] = useState({ ref: '', res: null, err: '', busy: false });

  useEffect(() => {
    const id = qrFromUrl(); setQr(id);
    if (id) api('/api/data').then((d) => setPt((d.qrpoints || {})[id] ? { id, ...d.qrpoints[id] } : null)).catch(() => {});
  }, []);

  async function pick(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try { const b = await toJpeg(f); setPhoto({ blob: b, url: URL.createObjectURL(b) }); } catch { setMsg("That photo couldn't be read. Try another."); }
  }
  async function send(e) {
    e.preventDefault(); setMsg('');
    if (!cat) { setMsg('Choose what it is about. · किस बारे में है, चुनें।'); return; }
    if (text.trim().length < 5) { setMsg('Please write a few words. · कृपया कुछ शब्द लिखें।'); return; }
    const fd = new FormData();
    fd.set('qr', qr); fd.set('cat', cat); fd.set('text', text); fd.set('mobile', mobile); fd.set('lang', /[ऀ-ॿ]/.test(text) ? 'hi' : 'en');
    fd.set('website', e.target.website.value);
    if (photo) fd.set('photo', photo.blob, 'photo.jpg');
    setBusy(true);
    try { const r = await api('/api/fb', { method: 'POST', body: fd }); setRef(r.ref); window.scrollTo(0, 0); }
    catch (er) { setMsg(er.message); }
    setBusy(false);
  }
  async function check(e) {
    e.preventDefault();
    setChk({ ...chk, busy: true, err: '', res: null });
    try { const r = await api('/api/fb?ref=' + encodeURIComponent(chk.ref)); setChk({ ...chk, res: r, err: '', busy: false }); }
    catch (er) { setChk({ ...chk, err: er.message, res: null, busy: false }); }
  }
  const back = qr ? '/#' + encodeURIComponent(qr) : '/';

  if (ref) return (
    <main className="xpage">
      <Brand title="Thank you · धन्यवाद" />
      <section className="panel">
        <p style={{ margin: 0 }}>We have received your message and passed it to the staff who look after this.</p>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>आपका संदेश मिल गया है और संबंधित कर्मचारियों को भेज दिया गया है।</p>
        <p className="label" style={{ marginTop: 16 }}>Your reference number · आपका संदर्भ नंबर</p>
        <div className="xref">{ref}</div>
        <p className="msg">Take a screenshot or note it down. Scan any station QR code, tap <b>Tell us</b>, and use <b>Check status</b> to see what has been done.</p>
        <div className="actions" style={{ marginTop: 12 }}>
          <a className="btn primary" href={back}>Directions · रास्ता देखें</a>
          <button className="btn" type="button" onClick={() => { setRef(''); setCat(''); setText(''); setPhoto(null); }}>Tell us something else</button>
        </div>
      </section>
    </main>
  );

  return (
    <main className="xpage">
      <Brand title="Tell us · हमें बताएं" />
      <div className="xhere">
        <div>
          <span>आप यहाँ हैं · You are at</span>
          <b>{pt ? (pt.nameHi ? `${pt.nameHi} · ${pt.name}` : pt.name) : qr ? 'Station point ' + qr.toUpperCase() : 'New Delhi Railway Station'}</b>
        </div>
      </div>
      <form className="form" onSubmit={send}>
        <section className="panel">
          <p className="label">What is it about? <span className="hi">किस बारे में है?</span></p>
          <div className="xcats">
            {CATS.map(([id, en, hi]) => (
              <button key={id} type="button" className="xcat" aria-pressed={cat === id} onClick={() => setCat(id)}><b>{hi}</b><span>{en}</span></button>
            ))}
          </div>
        </section>
        <section className="panel form">
          <div className="field">
            <label htmlFor="t">Tell us what you noticed · क्या देखा, बताएं</label>
            <textarea id="t" rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={cat === 'praise' ? 'Who or what was good? · क्या अच्छा लगा?' : 'For example: no water in the cooler near Gate 5 · जैसे: गेट 5 के पास कूलर में पानी नहीं है'} />
          </div>
          <div className="field">
            <label htmlFor="ph">Photo (optional) · फ़ोटो (वैकल्पिक)</label>
            <input id="ph" type="file" accept="image/*" capture="environment" onChange={pick} />
            {photo ? <img src={photo.url} alt="Your photo" style={{ maxWidth: 180, borderRadius: 8, marginTop: 6 }} /> : null}
          </div>
          <div className="field">
            <label htmlFor="m">Mobile number (optional) · मोबाइल नंबर (वैकल्पिक)</label>
            <input id="m" type="tel" inputMode="numeric" maxLength={13} value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="So we can call you back" />
            <small>Only the staff handling your message can see it.</small>
          </div>
          <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
          <button className="btn primary xbig" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send · भेजें'}</button>
          {msg ? <p className="msg err" role="status">{msg}</p> : null}
        </section>
      </form>

      <section className="panel" style={{ marginTop: 16 }}>
        <p className="label">Already told us? <span className="hi">स्थिति देखें</span></p>
        <form className="xrow" onSubmit={check}>
          <div className="field"><label htmlFor="r">Reference number</label>
            <input id="r" value={chk.ref} onChange={(e) => setChk({ ...chk, ref: e.target.value })} placeholder="T261018-K7MA" autoCapitalize="characters" /></div>
          <button className="btn" type="submit" disabled={chk.busy || !chk.ref}>Check status</button>
        </form>
        {chk.err ? <p className="msg err">{chk.err}</p> : null}
        {chk.res ? (
          <div style={{ marginTop: 10 }}>
            <p style={{ margin: 0 }}><span className={'xst ' + chk.res.status}>{chk.res.statusText}</span> {chk.res.catText} · {chk.res.place}</p>
            <p className="msg">Sent {fmtDate(chk.res.at)} {fmtTime(chk.res.at)} · updated {fmtDate(chk.res.updated)} {fmtTime(chk.res.updated)}</p>
            {chk.res.reply ? <p style={{ margin: '6px 0 0' }}><b>Reply:</b> {chk.res.reply}</p> : null}
          </div>
        ) : null}
      </section>

      <p className="msg" style={{ marginTop: 16 }}>Need urgent help, or a problem on a train? Call <b>Rail Madad 139</b>. · तत्काल सहायता के लिए <b>139</b> पर कॉल करें।</p>
      <p style={{ marginTop: 8 }}><a href={back}>← Directions · रास्ता देखें</a></p>
    </main>
  );
}

// Switched off in Control room → Staff & settings? Then this page shows a short notice instead.
export default function GateTell() {
  const [f, setF] = useState(null);
  useEffect(() => { api('/api/features').then(setF).catch(() => setF({ tell: true, duty: true })); }, []);
  if (!f) return <main className="xpage"><Brand title="Tell us · हमें बताएं" /><p className="msg">Loading…</p></main>;
  if (!f.tell) return (
    <main className="xpage"><Brand title="Tell us · हमें बताएं" />
      <div className="xstate"><b>Not available right now · अभी उपलब्ध नहीं</b><p style={{ margin: "6px 0 0" }}>For help, please speak to station staff or visit the enquiry counter. · सहायता के लिए स्टेशन कर्मचारी या पूछताछ काउंटर से संपर्क करें।</p></div>
      <p><a className="btn" href={'/' + (typeof location !== 'undefined' ? location.hash : '')}>Back to directions · रास्ता देखें</a></p></main>
  );
  return <TellPage />;
}
