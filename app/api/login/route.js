import { NextResponse } from 'next/server';
import { checkPassword, staffToken, COOKIE, loginConfigured } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!loginConfigured()) return new NextResponse('Staff sign-in is not set up. Add ADMIN_PASSWORD.', { status: 503 });
  let pw = '';
  try { pw = (await req.json()).password; } catch {}
  if (!checkPassword(pw)) {
    await new Promise((r) => setTimeout(r, 700));
    return new NextResponse('Wrong password', { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, staffToken(), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  return res;
}
