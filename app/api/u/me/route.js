import { getActor, can, publicUser, getDoc, FB_CATS, LEAVE_REASONS, dutyConfig } from '@/lib/people';
import { ok } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const a = await getActor(req);
  const base = { cats: FB_CATS, reasons: LEAVE_REASONS, config: await dutyConfig() };
  if (!a) return ok({ ...base, signedIn: false });
  const duty = a.user ? (await getDoc('dutynow', a.user.id)) : null;
  return ok({
    ...base, signedIn: true, admin: a.admin, name: a.name, user: publicUser(a.user), duty,
    can: { duty: !!(a.user && can(a, 'duty')), board: can(a, 'board'), staff: can(a, 'staff'), fb: can(a, 'fb') },
  });
}
