// Ticket checking staff at a gate: join duty, leave (with reason), rejoin, end duty.
// Every action needs: own sign-in, a live photo taken in the app, and the phone's location.
import { getActor, can, getDoc, putDoc, timeId, istIso, savePrivate, readJpeg, dutyConfig, metres, LEAVE_REASONS, features } from '@/lib/people';
import { ok, fail, clip } from '@/lib/http';
export const dynamic = 'force-dynamic';

const num = (v) => (v === null || v === '' || v == null || !isFinite(+v) ? null : +v);
const mins = (from, to = Date.now()) => Math.max(0, Math.round((to - Date.parse(from)) / 60000));

export async function POST(req) {
  if (!(await features()).duty) return fail('Gate duty is switched off at the moment.', 403);
  const a = await getActor(req);
  if (!a || !a.user) return fail('Sign in with your PF number and PIN first.', 401);
  if (!can(a, 'duty')) return fail('Your account is not set up for gate duty. Ask your office.', 403);
  let f; try { f = await req.formData(); } catch { return fail('Bad request'); }
  const action = clip(f.get('action'), 10), gate = clip(f.get('gate'), 60).toLowerCase();
  if (!['join', 'leave', 'rejoin', 'end'].includes(action)) return fail('Unknown action');
  const pt = await getDoc('qrpoints', gate);
  if (!pt) return fail('This QR code is not a known station point.', 404);
  const photo = await readJpeg(f.get('photo'));
  if (typeof photo === 'string') return fail('A live photo is required: ' + photo);

  const u = a.user, now = new Date(), cfg = await dutyConfig();
  const st = (await getDoc('dutynow', u.id)) || { state: 'off' };
  const gateName = pt.name;
  const flags = [];

  // ---- state rules ----
  let act = action, prevGate = null;
  if (action === 'join') {
    if (st.state === 'on' && st.gate === gate) return fail(`You are already on duty at ${gateName}.`, 409);
    if (st.state === 'away' && st.gate === gate) act = 'rejoin';
    else if (st.state !== 'off') { prevGate = st.gate; flags.push('moved'); }
  } else if (action === 'leave') {
    if (st.state !== 'on') return fail(st.state === 'away' ? 'You are already marked away. Scan again to rejoin.' : 'You are not on duty. Join duty first.', 409);
    if (st.gate !== gate) return fail(`You are on duty at ${st.gateName}. Scan the QR code at that gate to leave it.`, 409);
  } else if (action === 'rejoin') {
    if (st.state !== 'away') return fail('You are not marked away.', 409);
    if (st.gate !== gate) { prevGate = st.gate; flags.push('other-gate'); }
  } else if (action === 'end') {
    if (st.state === 'off') return fail('You are not on duty.', 409);
    if (st.gate !== gate) flags.push('other-gate');
  }

  let reason = '', reasonText = '', note = clip(f.get('note'), 300);
  if (act === 'leave') {
    reason = clip(f.get('reason'), 20);
    const r = LEAVE_REASONS.find((x) => x[0] === reason);
    if (!r) return fail('Choose why you are leaving the gate.');
    if (reason === 'other' && note.length < 3) return fail('Write why you are leaving the gate.');
    reasonText = r[1];
  }

  // ---- checks: location, device, photo freshness (recorded, not blocking) ----
  const lat = num(f.get('lat')), lng = num(f.get('lng')), acc = num(f.get('acc'));
  let dist = null;
  if (lat == null || lng == null) flags.push('no-gps');
  else if (typeof pt.lat === 'number' && typeof pt.lng === 'number') {
    dist = Math.round(metres({ lat, lng }, pt));
    if (dist - Math.min(acc || 0, 50) > cfg.radius) flags.push('far');
  }
  const dev = clip(f.get('device'), 40);
  if (!dev || !(u.devices || []).includes(dev)) flags.push('new-device');
  const shotAt = Date.parse(clip(f.get('shotAt'), 40));
  if (!isFinite(shotAt) || Math.abs(now - shotAt) > 3 * 60000) flags.push('late-photo');

  const photoKey = await savePrivate(photo, 'duty');
  const id = timeId(now), at = istIso(now);
  const ev = {
    user: u.id, name: u.name, pf: u.pf, action: act, gate, gateName, at, reason, reasonText, note,
    lat, lng, acc: acc == null ? null : Math.round(acc), dist, flags, photo: photoKey, device: dev,
  };
  if (prevGate) ev.prevGate = prevGate;
  if (act === 'rejoin' && st.since) ev.awayMin = mins(st.since, now);
  if (act === 'end' && st.joinedAt) ev.dutyMin = mins(st.joinedAt, now);
  await putDoc('duty', id, ev);

  const next = act === 'end' ? { state: 'off', since: at, lastGate: gate, lastGateName: gateName }
    : {
      state: act === 'leave' ? 'away' : 'on', gate, gateName, since: at,
      joinedAt: act === 'join' || !st.joinedAt ? at : st.joinedAt,
      reason, reasonText, note: act === 'leave' ? note : '',
    };
  Object.assign(next, { name: u.name, pf: u.pf, lastEvent: id, lastPhoto: photoKey, lastFlags: flags });
  await putDoc('dutynow', u.id, next);
  return ok({ ok: true, action: act, state: next, flags, dist });
}
