import { NextResponse } from 'next/server';
import { COOKIE } from '@/lib/auth';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const res = NextResponse.redirect(new URL('/', req.url));
  res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
