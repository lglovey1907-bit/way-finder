// Duty log for one day (IST), optionally for one person or one gate, with time-away totals.
import { getActor, can, listDocs, getDoc, photoUrl, istDay, dayKey, nextDayKey } from '@/lib/people';
import { ok, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const a = await getActor(req);
  if (!can(a, 'board')) return fail('Not allowed', 403);
  const q = new URL(req.url).searchParams;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get('day') || '') ? q.get('day') : istDay();
  const eq = {};
  if (q.get('user')) eq.user = q.get('user');
  if (q.get('gate')) eq.gate = q.get('gate');
  const k = dayKey(day);
  const evs = (await listDocs('duty', { gte: k, lt: nextDayKey(day), eq, limit: 5000 })).reverse();
  const users = Object.fromEntries((await listDocs('users')).map((u) => [u.id, u]));
  const sum = {};
  for (const e of evs) {
    const s = sum[e.user] || (sum[e.user] = { user: e.user, name: e.name, pf: e.pf, leaves: 0, awayMin: 0, dutyMin: 0, flags: 0, reasons: {}, gates: [], ref: photoUrl(users[e.user] && users[e.user].refPhoto) });
    if (e.action === 'leave') { s.leaves++; s.reasons[e.reasonText] = (s.reasons[e.reasonText] || 0) + 1; }
    if (e.awayMin) s.awayMin += e.awayMin;
    if (e.dutyMin) s.dutyMin += e.dutyMin;
    if ((e.flags || []).some((f) => f !== 'moved')) s.flags++;
    if (!s.gates.includes(e.gateName)) s.gates.push(e.gateName);
  }
  // Still away right now: count the time so far.
  if (day === istDay()) for (const s of Object.values(sum)) {
    const now = await getDoc('dutynow', s.user);
    if (now && now.state === 'away') { s.awayNow = Math.round((Date.now() - Date.parse(now.since)) / 60000); s.awayMin += s.awayNow; }
  }
  return ok({ day, events: evs.map((e) => ({ ...e, photo: photoUrl(e.photo) })), summary: Object.values(sum).sort((x, y) => y.awayMin - x.awayMin) });
}
