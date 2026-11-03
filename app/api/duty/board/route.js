// Live gate board: who is at which gate, who is away and for how long.
import { getActor, can, listDocs, dutyConfig, photoUrl, istIso, istDay, dayKey, nextDayKey } from '@/lib/people';
import { ok, fail } from '@/lib/http';
export const dynamic = 'force-dynamic';

const mins = (from) => Math.max(0, Math.round((Date.now() - Date.parse(from)) / 60000));

export async function GET(req) {
  const a = await getActor(req);
  if (!can(a, 'board')) return fail('Not allowed', 403);
  const [pts, users, now, cfg] = await Promise.all([listDocs('qrpoints'), listDocs('users'), listDocs('dutynow'), dutyConfig()]);
  const watch = cfg.watch || {};
  const uById = Object.fromEntries(users.map((u) => [u.id, u]));
  const gates = {};
  const isWatched = (p) => (watch[p.id] != null ? !!watch[p.id] : p.kind === 'Gate');
  for (const p of pts) gates[p.id] = { id: p.id, name: p.name, nameHi: p.nameHi || '', area: p.area, kind: p.kind, watched: isWatched(p), on: [], away: [] };
  const people = [];
  for (const s of now) {
    if (s.state === 'off' || !s.gate) continue;
    const u = uById[s.id] || {};
    const g = gates[s.gate] || (gates[s.gate] = { id: s.gate, name: s.gateName, area: '', watched: false, on: [], away: [] });
    const row = {
      user: s.id, name: s.name || u.name, pf: s.pf || u.pf, desig: u.desig || '', mobile: u.mobile || '',
      since: s.since, min: mins(s.since), joinedAt: s.joinedAt, dutyMin: s.joinedAt ? mins(s.joinedAt) : 0,
      reason: s.reasonText || '', note: s.note || '', flags: s.lastFlags || [],
      photo: photoUrl(s.lastPhoto), ref: photoUrl(u.refPhoto),
    };
    row.over = s.state === 'away' && row.min >= cfg.awayMin;
    row.long = row.dutyMin >= 12 * 60;
    (s.state === 'away' ? g.away : g.on).push(row);
    people.push({ ...row, state: s.state, gate: g.id, gateName: g.name });
  }
  const list = Object.values(gates).filter((g) => g.watched || g.on.length || g.away.length).map((g) => ({
    ...g, status: g.on.length ? 'manned' : g.away.length ? (g.away.some((x) => x.over) ? 'over' : 'away') : 'empty',
  }));
  const today = dayKey(istDay()), tomorrow = nextDayKey(istDay());
  const flagged = (await listDocs('duty', { gte: today, lt: tomorrow, limit: 3000 })).filter((e) => (e.flags || []).some((f) => f === 'far' || f === 'new-device'));
  return ok({
    at: istIso(), config: cfg, gates: list, people,
    alerts: {
      over: people.filter((p) => p.over),
      flagged: flagged.slice(0, 50).map((e) => ({ id: e.id, name: e.name, gateName: e.gateName, action: e.action, at: e.at, flags: e.flags, dist: e.dist, photo: photoUrl(e.photo) })),
    },
  });
}
