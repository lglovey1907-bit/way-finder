// Private photos: duty selfies and reference photos (gate board viewers), passenger photos (signed-in staff).
import { getActor, can, readPrivate } from '@/lib/people';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const k = new URL(req.url).searchParams.get('k') || '';
  const a = await getActor(req);
  const folder = k.split('/')[0];
  const allowed = folder === 'fb' ? !!a : (folder === 'duty' || folder === 'ref') ? (can(a, 'board') || can(a, 'staff')) : false;
  if (!allowed) return new Response('Not allowed', { status: 403 });
  const buf = await readPrivate(k);
  if (!buf) return new Response('Not found', { status: 404 });
  return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } });
}
