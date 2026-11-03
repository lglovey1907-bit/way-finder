// Staff accounts (PF number + own PIN), sessions, permissions and private photos.
// The shared ADMIN_PASSWORD sign-in (lib/auth.js) is the super-admin and can do everything here.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getDoc, putDoc, listDocs } from './store';
import { isStaff } from './auth';
import { supabase } from './supabase';

export const UCOOKIE = 'wf_user';
const secret = () => process.env.AUTH_SECRET || 'wf-user:' + (process.env.ADMIN_PASSWORD || 'ndls-demo');

// ---------- Tell us categories (passenger side wording) ----------
export const FB_CATS = [
  ['clean', 'Cleanliness', 'साफ़-सफ़ाई'],
  ['toilet', 'Toilets', 'शौचालय'],
  ['water', 'Drinking water', 'पीने का पानी'],
  ['power', 'Lights & fans', 'लाइट और पंखे'],
  ['lift', 'Lift / escalator', 'लिफ्ट / एस्केलेटर'],
  ['staff', 'Staff behaviour', 'कर्मचारी व्यवहार'],
  ['ticket', 'Tickets', 'टिकट'],
  ['food', 'Food & catering', 'खान-पान'],
  ['safety', 'Safety & security', 'सुरक्षा'],
  ['info', 'Signs & announcements', 'सूचना एवं उद्घोषणा'],
  ['praise', 'Appreciation', 'प्रशंसा'],
  ['other', 'Something else', 'अन्य'],
];
export const FB_STATUS = { new: 'Received', progress: 'Being looked into', resolved: 'Resolved' };

// ---------- gate duty ----------
export const LEAVE_REASONS = [
  ['meal', 'Meal / tea break', 'भोजन / चाय'],
  ['toilet', 'Toilet', 'शौचालय'],
  ['called', 'Called by supervisor / officer', 'अधिकारी द्वारा बुलाया गया'],
  ['passenger', 'Helping a passenger', 'यात्री की सहायता'],
  ['office', 'Office work / cash deposit', 'कार्यालय कार्य / नकद जमा'],
  ['other', 'Other', 'अन्य'],
];
export const DUTY_DEFAULTS = { awayMin: 15, radius: 75 };

// ---------- time ids (IST, sortable) ----------
export const istIso = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().replace('Z', '+05:30');
export const istDay = (d = new Date()) => istIso(d).slice(0, 10);
export const timeId = (d = new Date()) => istIso(d).slice(0, 23).replace(/[-:.]/g, '') + '-' + crypto.randomBytes(2).toString('hex');
export const dayKey = (day) => String(day).replace(/-/g, ''); // '2026-10-18' → '20261018'
// Key of the following day, for id ranges [dayKey(day), nextDayKey(day)). Digits only, so it sorts the same under any database collation.
export const nextDayKey = (day) => dayKey(new Date(Date.parse(day + 'T12:00:00Z') + 864e5).toISOString().slice(0, 10));

// ---------- PIN / setup code hashing ----------
export function hashSecret(s, salt = crypto.randomBytes(12).toString('hex')) {
  return salt + ':' + crypto.scryptSync(String(s), salt, 32).toString('hex');
}
export function checkSecret(s, stored) {
  if (!stored || typeof s !== 'string') return false;
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(s, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
export const newSetupCode = () => String(crypto.randomInt(100000, 1000000));
export const userId = (pf) => 'u-' + String(pf).trim().toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- session cookie: base64(json).hmac ----------
const sign = (s) => crypto.createHmac('sha256', secret()).update(s).digest('base64url');
export function makeSession(user) {
  const body = Buffer.from(JSON.stringify({ u: user.id, v: user.tv || 0, exp: Date.now() + 30 * 864e5 })).toString('base64url');
  return body + '.' + sign(body);
}
function readSession(req) {
  const c = req.cookies.get(UCOOKIE)?.value || '';
  const [body, mac] = c.split('.');
  if (!body || !mac) return null;
  const good = sign(body);
  if (mac.length !== good.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(good))) return null;
  try { const s = JSON.parse(Buffer.from(body, 'base64url').toString()); return s.exp > Date.now() ? s : null; } catch { return null; }
}
export const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 30 * 86400 };

// Who is calling: the admin password holder, a staff account, or nobody.
export async function getActor(req) {
  const s = readSession(req);
  let user = null;
  if (s) {
    const u = await getDoc('users', s.u);
    if (u && u.active !== false && (u.tv || 0) === s.v) user = { id: s.u, ...u };
  }
  if (isStaff(req)) return { admin: true, user, name: user ? user.name : 'Admin' };
  if (user) return { admin: false, user, name: user.name };
  return null;
}
// perms: { duty: TC gate duty, board: gate board + duty log, staff: manage accounts, fb: ['*'] or Tell us categories }
export function can(actor, what, cat) {
  if (!actor) return false;
  if (actor.admin) return true;
  const p = actor.user.perms || {};
  if (what === 'fb') { const f = p.fb || []; return f.includes('*') || (cat ? f.includes(cat) : f.length > 0); }
  if (what === 'board') return !!(p.board || p.staff);
  return !!p[what];
}
export function cleanPerms(p = {}) {
  const fbKeys = FB_CATS.map((c) => c[0]);
  const fb = Array.isArray(p.fb) ? (p.fb.includes('*') ? ['*'] : p.fb.filter((k) => fbKeys.includes(k))) : [];
  return { duty: !!p.duty, board: !!p.board, staff: !!p.staff, fb };
}
export const publicUser = (u) => u && ({
  id: u.id, name: u.name, pf: u.pf, desig: u.desig || '', mobile: u.mobile || '', perms: u.perms || {},
  active: u.active !== false, ready: !!u.pin, refPhoto: u.refPhoto || '', created: u.created, devices: (u.devices || []).length,
});

// ---------- private photos (duty selfies, passenger photos): never public ----------
const PRIV_BUCKET = process.env.SUPABASE_PRIVATE_BUCKET || 'private';
const PRIV_DIR = path.join(process.cwd(), '.data', 'private');
let bucketReady = false;
export async function savePrivate(buf, folder) {
  const keyName = `${folder}/${istDay()}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.jpg`;
  if (supabase) {
    if (!bucketReady) { await supabase.storage.createBucket(PRIV_BUCKET, { public: false }).catch(() => {}); bucketReady = true; }
    const { error } = await supabase.storage.from(PRIV_BUCKET).upload(keyName, buf, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error('Photo upload failed: ' + error.message);
    return keyName;
  }
  const f = path.join(PRIV_DIR, keyName);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  return keyName;
}
export async function readPrivate(keyName) {
  if (!/^[a-z]+\/\d{4}-\d{2}-\d{2}\/[0-9a-f-]+\.jpg$/.test(keyName)) return null;
  if (supabase) {
    const { data, error } = await supabase.storage.from(PRIV_BUCKET).download(keyName);
    return error ? null : Buffer.from(await data.arrayBuffer());
  }
  try { return fs.readFileSync(path.join(PRIV_DIR, keyName)); } catch { return null; }
}
export const photoUrl = (k) => (k ? '/api/pfile?k=' + encodeURIComponent(k) : '');

// Read an uploaded JPEG from a form field; returns a Buffer or an error string.
export async function readJpeg(file, max = 3 * 1024 * 1024) {
  if (!file || typeof file === 'string') return 'No photo';
  if (file.size > max) return 'Photo is too large';
  const buf = Buffer.from(await file.arrayBuffer());
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return 'Photo must be a JPEG';
  return buf;
}

export async function dutyConfig() {
  return { ...DUTY_DEFAULTS, ...((await getDoc('config', 'duty')) || {}) };
}
export async function allUsers() { return listDocs('users'); }

// Haversine distance in metres.
export function metres(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export { getDoc, putDoc, listDocs };

// On/off switches for the two optional features. Both are on unless switched off in Control room → Staff & settings.
export async function features() {
  const f = (await getDoc('config', 'features')) || {};
  return { tell: f.tell !== false, duty: f.duty !== false, updatedAt: f.updatedAt || null, updatedBy: f.updatedBy || null };
}
