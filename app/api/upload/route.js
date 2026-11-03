import { NextResponse } from 'next/server';
import { put, del } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { isStaff } from '@/lib/auth';
import { supabase, PHOTO_BUCKET } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

// Photo storage, in order of preference: Supabase Storage, Vercel Blob, local .data/uploads.
const MAX = 8 * 1024 * 1024;
const useBlob = () => !supabase && !!process.env.BLOB_READ_WRITE_TOKEN;
const LOCAL_DIR = path.join(process.cwd(), '.data', 'uploads');

export async function POST(req) {
  if (!isStaff(req)) return new NextResponse('Staff sign-in required', { status: 401 });
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return new NextResponse('No file', { status: 400 });
  if (file.size > MAX) return new NextResponse('Too large', { status: 413 });
  if (!/^image\/(jpeg|png|webp)$/.test(file.type || 'image/jpeg')) return new NextResponse('Images only', { status: 415 });
  const name = `${Date.now()}-${crypto.randomBytes(5).toString('hex')}.jpg`;
  const buf = Buffer.from(await file.arrayBuffer());

  if (supabase) {
    const objectPath = `wayfinder/${name}`;
    const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(objectPath, buf, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
    if (error) return new NextResponse('Photo upload failed: ' + error.message, { status: 502 });
    const { data } = supabase.storage.from(PHOTO_BUCKET).getPublicUrl(objectPath);
    return NextResponse.json({ url: data.publicUrl });
  }
  if (useBlob()) {
    const blob = await put(`wayfinder/photos/${name}`, buf, { access: 'public', contentType: 'image/jpeg' });
    return NextResponse.json({ url: blob.url });
  }
  try {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_DIR, name), buf);
  } catch {
    return new NextResponse('No photo store configured. Add the Supabase keys.', { status: 503 });
  }
  return NextResponse.json({ url: `/api/file/${name}` });
}

export async function DELETE(req) {
  if (!isStaff(req)) return new NextResponse('Staff sign-in required', { status: 401 });
  const url = new URL(req.url).searchParams.get('url') || '';
  try {
    const marker = `/storage/v1/object/public/${PHOTO_BUCKET}/`;
    if (supabase && url.includes(marker)) {
      await supabase.storage.from(PHOTO_BUCKET).remove([decodeURIComponent(url.split(marker)[1])]);
    } else if (useBlob() && /^https:\/\/[a-z0-9.-]+\.blob\.vercel-storage\.com\//i.test(url)) {
      await del(url);
    } else if (url.startsWith('/api/file/')) {
      fs.unlinkSync(path.join(LOCAL_DIR, path.basename(url)));
    }
  } catch { /* already gone */ }
  return NextResponse.json({ ok: true });
}
