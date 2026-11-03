import { NextResponse } from 'next/server';
import { isStaff, loginConfigured } from '@/lib/auth';
import { storeMode } from '@/lib/store';
import { supabase } from '@/lib/supabase';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const photos = supabase ? 'supabase' : process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local';
  return NextResponse.json(
    { admin: isStaff(req), login: loginConfigured(), store: storeMode(), photos, blob: photos !== 'local' },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
