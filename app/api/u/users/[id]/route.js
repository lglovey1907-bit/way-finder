import { getActor, can, putDoc, getDoc, publicUser, hashSecret, newSetupCode, cleanPerms } from '@/lib/people';
import { ok, fail, jsonBody, clip, readId } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function PUT(req, ctx) {
  const a = await getActor(req);
  if (!can(a, 'staff')) return fail('Only staff managers can change accounts', 403);
  const id = await readId(ctx);
  const u = await getDoc('users', id);
  if (!u) return fail('No such account', 404);
  let b; try { b = await jsonBody(req); } catch { return fail('Bad request'); }
  if (b.name != null) u.name = clip(b.name, 60) || u.name;
  if (b.desig != null) u.desig = clip(b.desig, 40);
  if (b.mobile != null) u.mobile = clip(b.mobile, 15);
  if (b.perms) {
    if (a.user && a.user.id === id && !a.admin && !b.perms.staff) return fail("You can't remove your own staff-manager access.");
    u.perms = cleanPerms(b.perms);
  }
  let code;
  if (b.active != null && !!b.active !== (u.active !== false)) { u.active = !!b.active; u.tv = (u.tv || 0) + 1; }
  if (b.reset) {
    // New one-time code: signs the person out everywhere; they set a new PIN and photo.
    code = newSetupCode();
    u.setup = { hash: hashSecret(code), exp: Date.now() + 7 * 864e5 };
    delete u.pin; delete u.lockUntil; u.devices = []; u.tv = (u.tv || 0) + 1;
  }
  u.updated = new Date().toISOString(); u.updatedBy = a.name;
  await putDoc('users', id, u);
  return ok({ ok: true, user: publicUser({ id, ...u }), code });
}
