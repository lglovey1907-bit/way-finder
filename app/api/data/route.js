import { NextResponse } from 'next/server';
import { getAll, storeMode } from '@/lib/store';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const data = await getAll();
    return NextResponse.json({ ...data, mode: storeMode() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return new NextResponse('Store unavailable', { status: 503 });
  }
}
