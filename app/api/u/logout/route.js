import { NextResponse } from 'next/server';
import { UCOOKIE } from '@/lib/people';
export const dynamic = 'force-dynamic';
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(UCOOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
