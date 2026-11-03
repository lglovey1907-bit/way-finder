// Feature switches: GET is public (pages hide switched-off features), PUT needs admin or "Manage staff & settings".
import { getActor, can, putDoc, features } from '@/lib/people';
import { ok, fail, jsonBody } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET() {
  try { const f = await features(); return ok({ tell: f.tell, duty: f.duty }); }
  catch { return ok({ tell: true, duty: true }); }
}
export async function PUT(req) {
  const a = await getActor(req);
  if (!can(a, 'staff')) return fail('Only the admin or staff managers can switch features on or off', 403);
  let b; try { b = await jsonBody(req); } catch { return fail('Bad request'); }
  const cur = await features();
  const next = { tell: b.tell == null ? cur.tell : !!b.tell, duty: b.duty == null ? cur.duty : !!b.duty, updatedAt: new Date().toISOString(), updatedBy: a.name || 'admin' };
  await putDoc('config', 'features', next);
  return ok({ ok: true, ...next });
}
