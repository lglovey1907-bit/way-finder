// Served at /.well-known/assetlinks.json (see next.config.mjs). Paste the JSON that
// PWABuilder gives you into the ANDROID_ASSETLINKS environment variable so the Android
// app opens full-screen without a browser bar.
export const dynamic = 'force-dynamic';
export async function GET() {
  let body = '[]';
  try { if (process.env.ANDROID_ASSETLINKS) body = JSON.stringify(JSON.parse(process.env.ANDROID_ASSETLINKS)); } catch {}
  return new Response(body, { headers: { 'Content-Type': 'application/json' } });
}
