import { NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';

export async function GET() {
  const store = await getStore();
  return NextResponse.json({ targets: store.listTargets() });
}
