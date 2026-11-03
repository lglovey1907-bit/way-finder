// "Tell us" from passengers (public): send a message from a station QR point; check its status by reference.
import crypto from 'crypto';
import { getDoc, putDoc, listDocs, timeId, istIso, savePrivate, readJpeg, FB_CATS, FB_STATUS, features } from '@/lib/people';
import { ok, fail, clip } from '@/lib/http';
export const dynamic = 'force-dynamic';

const hits = new Map(); // light per-IP limit: 6 messages per 10 minutes on this server instance
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60000);
  list.push(now); hits.set(ip, list);
  return list.length > 6;
}
const ALPHA = 'ACDEFHJKMNPRTUVWXY3479';
const newRef = () => 'T' + istIso().slice(2, 10).replace(/-/g, '') + '-' + Array.from(crypto.randomBytes(4), (b) => ALPHA[b % ALPHA.length]).join('');

export async function POST(req) {
  if (!(await features()).tell) return fail('Tell us is switched off at the moment. Please speak to station staff or the enquiry counter.', 403);
  let f; try { f = await req.formData(); } catch { return fail('Bad request'); }
  if (clip(f.get('website'), 10)) return ok({ ok: true, ref: newRef() }); // bots fill hidden fields
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
  if (limited(ip)) return fail('Too many messages from this phone. Please try again in a few minutes.', 429);
  const qr = clip(f.get('qr'), 60).toLowerCase(), cat = clip(f.get('cat'), 20);
  const c = FB_CATS.find((x) => x[0] === cat);
  if (!c) return fail('Choose what it is about.');
  const text = clip(f.get('text'), 1000);
  if (text.length < 5) return fail('Please write a few words about it.');
  const mobile = clip(f.get('mobile'), 15).replace(/[^\d+]/g, '');
  if (mobile && !/^(\+?91)?[6-9]\d{9}$/.test(mobile)) return fail('Mobile number should be a 10-digit Indian number, or leave it empty.');
  const pt = qr ? await getDoc('qrpoints', qr) : null;
  let photo = '';
  const file = f.get('photo');
  if (file && typeof file !== 'string' && file.size) {
    const buf = await readJpeg(file, 4 * 1024 * 1024);
    if (typeof buf === 'string') return fail(buf);
    photo = await savePrivate(buf, 'fb');
  }
  const ref = newRef(), at = istIso();
  const doc = {
    ref, qr: pt ? qr : '', place: pt ? pt.name : 'Not from a QR board', placeHi: pt ? pt.nameHi || '' : '', area: pt ? pt.area : '',
    cat, catText: c[1], text, mobile, lang: clip(f.get('lang'), 5), photo, status: 'new', at, updated: at, assign: null,
    ipHash: crypto.createHash('sha256').update(ip + (process.env.AUTH_SECRET || '')).digest('hex').slice(0, 16),
    log: [{ at, by: 'Passenger', status: 'new', remark: '' }],
  };
  await putDoc('fb', timeId(), doc);
  return ok({ ok: true, ref });
}

export async function GET(req) {
  const ref = clip(new URL(req.url).searchParams.get('ref'), 20).toUpperCase().replace(/\s/g, '');
  if (!/^T\d{6}-[A-Z0-9]{4}$/.test(ref)) return fail('Reference number looks wrong. It is like T261018-K7MA.', 400);
  const [d] = await listDocs('fb', { eq: { ref }, limit: 1 });
  if (!d) return fail('No message found with this reference number.', 404);
  const pub = (d.log || []).filter((l) => l.public && l.remark).pop();
  return ok({ ref: d.ref, place: d.place, placeHi: d.placeHi, cat: d.cat, catText: d.catText, at: d.at, status: d.status, statusText: FB_STATUS[d.status], updated: d.updated, reply: pub ? pub.remark : '' });
}
