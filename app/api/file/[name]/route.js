// Serves photos stored locally (only used when no Vercel Blob token is set).
import fs from 'fs';
import path from 'path';
export const dynamic = 'force-dynamic';

export async function GET(_req, ctx) {
  const params = (await (ctx && ctx.params)) || {};
  const name = path.basename(params.name || '');
  if (!/^[a-z0-9-]+\.jpg$/i.test(name)) return new Response('Not found', { status: 404 });
  try {
    const buf = fs.readFileSync(path.join(process.cwd(), '.data', 'uploads', name));
    return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
