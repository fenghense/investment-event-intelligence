'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AppNotification, NotificationKind } from '@/lib/domain/types';
import { NOTIFICATION_KIND_LABELS, STATUS_LABELS } from '@/lib/domain/vocabulary';
import { PageHeader, formatDateTime } from '@/components/app/ui-bits';

const KIND_STYLE: Record<NotificationKind, { fg: string; bg: string; rail: string }> = {
  fact_revocation: { fg: '#991b1b', bg: '#fdedec', rail: '#991b1b' },
  fact_update: { fg: '#d93025', bg: '#fdedec', rail: '#d93025' },
  status_info: { fg: '#6b7280', bg: '#f3f4f6', rail: '#9ca3af' },
};

export default function NotificationsPage() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [kindFilter, setKindFilter] = useState<NotificationKind | 'all'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (kindFilter !== 'all') params.set('kind', kindFilter);
        const res = await fetch(`/api/notifications?${params.toString()}`, { cache: 'no-store' });
        const data = (await res.json()) as {
          notifications: AppNotification[];
          unread: number;
          favoriteCount?: number;
        };
        if (!cancelled) {
          setNotifications(data.notifications);
          setUnread(data.unread);
          setFavoriteCount(data.favoriteCount ?? 0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [kindFilter]);

  const openNotification = async (n: AppNotification): Promise<void> => {
    if (!n.read) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      await fetch(`/api/notifications/${n.id}/read`, { method: 'POST' });
    }
    router.push(`/events/${n.eventId}`);
  };

  const filters: Array<{ key: NotificationKind | 'all'; label: string }> = [
    { key: 'all', label: '全部' },
    { key: 'fact_revocation', label: '事实撤销类' },
    { key: 'fact_update', label: '事实更新类' },
    { key: 'status_info', label: '状态信息' },
  ];

  return (
    <div>
      <PageHeader
        title="通知中心"
        en="State Change Alerts"
        extra={
          <div className="mono text-xs text-[#6b7280]">
            未读 <b className="text-[#991b1b]">{unread}</b> / 共 {notifications.length} 条
          </div>
        }
      />

      <div className="mb-4 flex items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setKindFilter(f.key)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-all ${
              kindFilter === f.key
                ? 'border-[#d93025] bg-[#d93025] text-white'
                : 'border-[#e5e7eb] bg-white text-[#6b7280] hover:border-[#9ca3af]'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-[#6b7280]">
          仅推送已收藏事件 · 更正 / 否认 / 反转均显式标注差异，禁止无声修改
        </span>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="paper-card animate-pulse p-4">
              <div className="h-4 w-1/3 rounded bg-[#eceef3]" />
              <div className="mt-2 h-3 w-1/2 rounded bg-[#eceef3]" />
            </div>
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="paper-card py-16 text-center">
          {favoriteCount === 0 ? (
            <>
              <p className="text-sm font-medium text-[#1f2329]">尚未收藏任何事件</p>
              <p className="mx-auto mt-2 max-w-md text-[12.5px] leading-relaxed text-[#6b7280]">
                点击热点事件卡片右上角的 ☆ 收藏图标后，该事件的状态变更通知（更新 / 更正 / 否认 / 反转）才会推送到这里。
              </p>
              <Link
                href="/events"
                className="mt-4 inline-block rounded-md bg-[#d93025] px-5 py-2 text-[13px] font-medium text-white transition-colors hover:bg-[#b9261d]"
              >
                去事件监控收藏关注的事件 →
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-[#1f2329]">已收藏 {favoriteCount} 个事件，暂无通知</p>
              <p className="mt-2 text-[12.5px] text-[#6b7280]">当收藏事件的状态发生变化时，将在此提醒你。</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {notifications.map((n) => {
            const s = KIND_STYLE[n.kind];
            return (
              <button
                key={n.id}
                onClick={() => openNotification(n)}
                className={`paper-card paper-card-hover block w-full p-4 text-left ${n.read ? '' : 'unread-pulse'}`}
                style={{ borderLeft: `3px solid ${s.rail}` }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
                    style={{ color: s.fg, backgroundColor: s.bg }}
                  >
                    {NOTIFICATION_KIND_LABELS[n.kind]}
                  </span>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-[#991b1b]" title="未读" />}
                  <span className="text-[14px] font-semibold text-[#1f2329]">{n.title}</span>
                  <span className="mono ml-auto text-[11px] text-[#6b7280]">{formatDateTime(n.createdAt)}</span>
                </div>
                <div className="mono mt-1.5 text-[11.5px] text-[#6b7280]">
                  {n.eventTitle} · {STATUS_LABELS[n.fromStatus]} → {STATUS_LABELS[n.toStatus]}
                </div>
                {n.diffNote && (
                  <div className={`diff-note mt-2 ${n.kind === 'fact_update' ? 'diff-note-neutral' : ''}`}>
                    {n.diffNote}
                  </div>
                )}
                <div className="mono mt-2 text-[10px] uppercase tracking-wider text-[#9ca3af]">
                  点击查看事件详情 →
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
