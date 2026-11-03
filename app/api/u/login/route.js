import { getDoc, putDoc, userId, checkSecret, makeSession, UCOOKIE, cookieOpts, publicUser } from '@/lib/people';
import { ok, fail, jsonBody, clip, sleep } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  let b; try { b = await jsonBody(req); } catch { return fail('Bad request'); }
  const pf = clip(b.pf, 30), pin = clip(b.pin, 12), id = userId(pf);
  const u = pf ? await getDoc('users', id) : null;
  const bad = async (msg = 'PF number or PIN is not right.') => { await sleep(700); return fail(msg, 401); };
  if (!u || u.active === false) return bad();
  if (!u.pin) return bad('This account is not set up yet. Use "First time" with the setup code from your office.');
  if (u.lockUntil && u.lockUntil > Date.now()) return bad(`Too many wrong PINs. Try again after ${Math.ceil((u.lockUntil - Date.now()) / 60000)} min, or ask your office to reset it.`);
  if (!checkSecret(pin, u.pin)) {
    u.fails = (u.fails || 0) + 1;
    if (u.fails >= 5) { u.lockUntil = Date.now() + 15 * 60000; u.fails = 0; }
    await putDoc('users', id, u);
    return bad();
  }
  const dev = clip(b.device, 40);
  u.fails = 0; delete u.lockUntil; u.lastLogin = new Date().toISOString();
  if (dev && !(u.devices || []).includes(dev)) u.devices = [...(u.devices || []), dev].slice(-5);
  await putDoc('users', id, u);
  const res = ok({ ok: true, user: publicUser({ id, ...u }) });
  res.cookies.set(UCOOKIE, makeSession({ id, ...u }), cookieOpts);
  return res;
}
