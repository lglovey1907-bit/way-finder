// First sign-in: PF number + one-time setup code from the office → own PIN + reference photo.
import { getDoc, putDoc, userId, checkSecret, hashSecret, makeSession, UCOOKIE, cookieOpts, publicUser, savePrivate, readJpeg } from '@/lib/people';
import { ok, fail, clip, sleep } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  let f; try { f = await req.formData(); } catch { return fail('Bad request'); }
  const pf = clip(f.get('pf'), 30), code = clip(f.get('code'), 10), pin = clip(f.get('pin'), 12), id = userId(pf);
  const u = pf ? await getDoc('users', id) : null;
  if (!u || u.active === false || !u.setup || u.setup.exp < Date.now() || !checkSecret(code, u.setup.hash)) {
    await sleep(800);
    return fail('PF number or setup code is not right, or the code has expired. Ask your office for a new code.', 401);
  }
  if (!/^\d{4,6}$/.test(pin)) return fail('PIN must be 4 to 6 digits.');
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return fail('Choose a PIN that is harder to guess (not 1111 or 1234).');
  const photo = await readJpeg(f.get('photo'));
  if (typeof photo === 'string') return fail('Take your photo first: ' + photo);
  const dev = clip(f.get('device'), 40);
  u.pin = hashSecret(pin);
  u.refPhoto = await savePrivate(photo, 'ref');
  u.devices = dev ? [dev] : [];
  u.setupAt = new Date().toISOString();
  delete u.setup; u.fails = 0;
  await putDoc('users', id, u);
  const res = ok({ ok: true, user: publicUser({ id, ...u }) });
  res.cookies.set(UCOOKIE, makeSession({ id, ...u }), cookieOpts);
  return res;
}
