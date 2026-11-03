// Staff sign-in: one shared password (ADMIN_PASSWORD) → signed, httpOnly cookie.
import crypto from 'crypto';

export const COOKIE = 'wf_staff';
const password = () => process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' ? 'ndls-demo' : null);
const secret = () => process.env.AUTH_SECRET || 'wf:' + (password() || '');
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();

export function staffToken() {
  return crypto.createHmac('sha256', secret()).update('wf-staff:' + password()).digest('hex');
}
export function checkPassword(pw) {
  const p = password();
  if (!p || typeof pw !== 'string') return false;
  return crypto.timingSafeEqual(hash(pw), hash(p));
}
export function isStaff(req) {
  if (!password()) return false;
  const c = req.cookies.get(COOKIE)?.value;
  if (!c) return false;
  const t = staffToken();
  return c.length === t.length && crypto.timingSafeEqual(Buffer.from(c), Buffer.from(t));
}
export const loginConfigured = () => !!password();
