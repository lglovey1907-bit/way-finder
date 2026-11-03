import { NextResponse } from 'next/server';
import { COLS, putDoc, deleteDoc } from '@/lib/store';
import { isStaff } from '@/lib/auth';
export const dynamic = 'force-dynamic';

const ID = /^[A-Za-z0-9_\-.~:@+]{1,120}$/;
// Next 15+ passes params as a Promise; Next 14 as a plain object. Awaiting works for both.
async function readParams(ctx) {
  const p = (await (ctx && ctx.params)) || {};
  return { col: String(p.col || ''), id: decodeURIComponent(String(p.id || '')) };
}
function check(req, params) {
  if (!COLS.includes(params.col) || !ID.test(params.id)) return new NextResponse(`Unknown record ${params.col}/${params.id}`, { status: 404 });
  if (!isStaff(req)) return new NextResponse('Staff sign-in required', { status: 401 });
  return null;
}

export async function PUT(req, ctx) {
  const params = await readParams(ctx);
  const bad = check(req, params);
  if (bad) return bad;
  const text = await req.text();
  // the drawn station map is stored one floor per record, which can be larger than other records
  if (text.length > (params.col === 'indoor' ? 900 * 1024 : 64 * 1024)) return new NextResponse('Too large', { status: 413 });
  let body;
  try { body = JSON.parse(text); } catch { return new NextResponse('Bad JSON', { status: 400 }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return new NextResponse('Body must be an object', { status: 400 });
  try { await putDoc(params.col, params.id, body); }
  catch (e) { return new NextResponse('Store error: ' + (e && e.message), { status: 502 }); }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, ctx) {
  const params = await readParams(ctx);
  const bad = check(req, params);
  if (bad) return bad;
  try { await deleteDoc(params.col, params.id); }
  catch (e) { return new NextResponse('Store error: ' + (e && e.message), { status: 502 }); }
  return NextResponse.json({ ok: true });
}
