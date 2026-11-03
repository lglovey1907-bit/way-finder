import { NextResponse } from 'next/server';
export const ok = (d = { ok: true }) => NextResponse.json(d, { headers: { 'Cache-Control': 'no-store' } });
export const fail = (msg, status = 400) => new NextResponse(msg, { status, headers: { 'Cache-Control': 'no-store' } });
export async function jsonBody(req, max = 32 * 1024) {
  const t = await req.text();
  if (t.length > max) throw new Error('Too large');
  return t ? JSON.parse(t) : {};
}
export const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function readId(ctx) { const p = (await (ctx && ctx.params)) || {}; return decodeURIComponent(String(p.id || '')); }
