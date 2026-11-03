// Tell us inbox for staff. Each person sees only the categories they handle, plus messages forwarded to them.
import { getActor, can, listDocs, photoUrl, istIso, dayKey } from '@/lib/people';
import { ok, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const a = await getActor(req);
  if (!a) return fail('Sign in first', 401);
  const q = new URL(req.url).searchParams;
  const days = Math.min(365, Math.max(1, +q.get('days') || 30));
  const from = dayKey(istIso(new Date(Date.now() - days * 864e5)).slice(0, 10));
  const all = await listDocs('fb', { gte: from, limit: 5000 });
  const me = a.user && a.user.id;
  const mine = all.filter((d) => can(a, 'fb', d.cat) || (me && d.assign === me));
  if (!mine.length && !can(a, 'fb')) return fail('Your account does not handle Tell us messages.', 403);
  return ok({
    items: mine.map(({ ipHash, ...d }) => ({ ...d, photo: photoUrl(d.photo) })),
    scope: a.admin ? ['*'] : (a.user.perms && a.user.perms.fb) || [],
  });
}
