import { getActor, can, getDoc, putDoc, istIso, FB_STATUS } from '@/lib/people';
import { ok, fail, jsonBody, clip, readId } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function PUT(req, ctx) {
  const a = await getActor(req);
  const id = await readId(ctx);
  const d = await getDoc('fb', id);
  if (!d) return fail('Not found', 404);
  const me = a && a.user && a.user.id;
  if (!(can(a, 'fb', d.cat) || (me && d.assign === me))) return fail('Not allowed', 403);
  let b; try { b = await jsonBody(req); } catch { return fail('Bad request'); }
  const at = istIso(), entry = { at, by: a.name };
  if (b.status && FB_STATUS[b.status] && b.status !== d.status) { d.status = b.status; entry.status = b.status; }
  if (b.assign !== undefined) {
    const to = b.assign ? await getDoc('users', String(b.assign)) : null;
    if (b.assign && !to) return fail('No such staff member');
    d.assign = b.assign || null; d.assignName = to ? to.name : '';
    entry.assign = d.assignName || 'nobody';
  }
  const remark = clip(b.remark, 500);
  if (remark) { entry.remark = remark; entry.public = !!b.public; }
  if (entry.status === 'resolved' && !remark) return fail('Write what was done before marking it resolved.');
  if (Object.keys(entry).length <= 2) return fail('Nothing to change');
  d.log = [...(d.log || []), entry]; d.updated = at;
  await putDoc('fb', id, d);
  const { ipHash, ...out } = d;
  return ok({ ok: true, item: { id, ...out } });
}
