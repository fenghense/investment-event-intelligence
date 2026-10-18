import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const notification = store.markNotificationRead(id);
  if (!notification) {
    return NextResponse.json({ error: `通知不存在：${id}` }, { status: 404 });
  }
  return NextResponse.json({ notification });
}
