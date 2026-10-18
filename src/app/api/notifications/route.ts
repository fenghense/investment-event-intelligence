import { NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';

// 通知中心：仅推送「已收藏事件」的状态变更通知（收藏入口在事件卡片右上角）
export async function GET() {
  const store = await getStore();
  const notifications = store.listFavoriteNotifications();
  return NextResponse.json({
    notifications,
    unread: notifications.filter((n) => !n.read).length,
    favoriteCount: store.favoriteCount(),
  });
}
