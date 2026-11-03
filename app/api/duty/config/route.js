import { getActor, can, putDoc, dutyConfig } from '@/lib/people';
import { ok, fail, jsonBody } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function PUT(req) {
  const a = await getActor(req);
  if (!can(a, 'staff')) return fail('Only staff managers can change these settings', 403);
  let b; try { b = await jsonBody(req); } catch { return fail('Bad request'); }
  const c = await dutyConfig();
  if (b.awayMin != null) c.awayMin = Math.min(240, Math.max(1, Math.round(+b.awayMin) || 15));
  if (b.radius != null) c.radius = Math.min(1000, Math.max(20, Math.round(+b.radius) || 75));
  if (b.watch && typeof b.watch === 'object') {
    c.watch = { ...(c.watch || {}) };
    for (const [k, v] of Object.entries(b.watch)) if (/^[a-z0-9_.:~@+-]{1,120}$/.test(k)) c.watch[k] = !!v;
  }
  await putDoc('config', 'duty', c);
  return ok({ ok: true, config: c });
}
