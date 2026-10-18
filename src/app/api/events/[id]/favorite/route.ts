import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';

// 收藏切换：只有已收藏的事件才会在通知中心推送状态变更通知
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const favorited = store.toggleFavorite(id);
  if (favorited === undefined) {
    return NextResponse.json({ error: `事件不存在：${id}` }, { status: 404 });
  }
  return NextResponse.json({ eventId: id, favorited, favoriteCount: store.favoriteCount() });
}
