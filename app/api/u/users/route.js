import { getActor, can, putDoc, getDoc, allUsers, publicUser, userId, hashSecret, newSetupCode, cleanPerms } from '@/lib/people';
import { ok, fail, jsonBody, clip } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const a = await getActor(req);
  if (!a) return fail('Sign in first', 401);
  const list = (await allUsers()).map(publicUser);
  // Everyone signed in may see names (for "forward to"); only staff managers see the rest.
  if (!can(a, 'staff')) return ok({ users: list.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, desig: u.desig, fb: u.perms.fb })) });
  return ok({ users: list.sort((x, y) => x.name.localeCompare(y.name)) });
}

export async function POST(req) {
  const a = await getActor(req);
  if (!can(a, 'staff')) return fail('Only staff managers can add accounts', 403);
  let b; try { b = await jsonBody(req); } catch { return fail('Bad request'); }
  const name = clip(b.name, 60), pf = clip(b.pf, 30);
  if (!name || !/^[A-Za-z0-9/-]{3,30}$/.test(pf)) return fail('Name and a PF / HRMS number (letters and digits) are needed.');
  const id = userId(pf);
  if (await getDoc('users', id)) return fail('An account with this PF number already exists.', 409);
  const code = newSetupCode();
  const u = {
    name, pf: pf.toUpperCase(), desig: clip(b.desig, 40), mobile: clip(b.mobile, 15), perms: cleanPerms(b.perms),
    active: true, tv: 0, created: new Date().toISOString(), createdBy: a.name,
    setup: { hash: hashSecret(code), exp: Date.now() + 7 * 864e5 },
  };
  await putDoc('users', id, u);
  return ok({ ok: true, user: publicUser({ id, ...u }), code });
}
