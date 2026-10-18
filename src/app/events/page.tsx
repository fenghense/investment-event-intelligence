'use client';

import { useEffect, useState } from 'react';
import type { EventStatus } from '@/lib/domain/types';
import {
  PageHeader,
  StatusGroupChip,
} from '@/components/app/ui-bits';
import { EventCard, type EventCardData } from '@/components/app/event-card';

type Stats = Record<EventStatus, number> & { total: number; unreadNotifications: number };

const STATUS_FILTERS: EventStatus[] = ['published', 'updated', 'corrected', 'denied', 'expired', 'revived'];

export default function EventListPage() {
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statusFilter, setStatusFilter] = useState<EventStatus | 'all'>('all');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (q.trim()) params.set('q', q.trim());
        const res = await fetch(`/api/events?${params.toString()}`, { cache: 'no-store' });
        const data = (await res.json()) as { events: EventCardData[]; stats: Stats };
        if (!cancelled) {
          setEvents(data.events);
          setStats(data.stats);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [statusFilter, q]);

  return (
    <div>
      <PageHeader
        title="事件监控"
        en="Investment Event Intelligence"
        extra={
          stats && (
            <div className="mono flex items-center gap-3 text-xs text-[#6b7280]">
              <span>
                事件 <b className="text-[#1f2329]">{stats.total}</b>
              </span>
              <span>
                未读通知 <b className="text-[#991b1b]">{stats.unreadNotifications}</b>
              </span>
            </div>
          )
        }
      />

      {/* 筛选栏 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatusFilter('all')}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-all ${
            statusFilter === 'all'
              ? 'border-[#d93025] bg-[#d93025] text-white'
              : 'border-[#e5e7eb] bg-white text-[#6b7280] hover:border-[#9ca3af]'
          }`}
        >
          全部{stats ? ` ${stats.total}` : ''}
        </button>
        {STATUS_FILTERS.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className="transition-transform active:scale-95">
            <StatusGroupChip status={s} active={statusFilter === s} />
          </button>
        ))}
        <div className="ml-auto">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索事件标题 / 摘要…"
            className="w-64 rounded-md border border-[#e5e7eb] bg-white px-3 py-1.5 text-[13px] outline-none transition-colors placeholder:text-[#9ca3af] focus:border-[#d93025]"
          />
        </div>
      </div>

      {/* 事件卡片列表 */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="paper-card animate-pulse p-4">
              <div className="flex items-center gap-2">
                <div className="h-5 w-16 rounded-full bg-[#eceef3]" />
                <div className="h-5 w-2/5 rounded bg-[#eceef3]" />
              </div>
              <div className="mt-2.5 h-4 w-3/4 rounded bg-[#eceef3]" />
              <div className="mt-2 h-3 w-1/2 rounded bg-[#eceef3]" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        <div className="paper-card py-16 text-center">
          <p className="text-sm text-[#6b7280]">暂无匹配事件</p>
          <p className="mt-1 text-xs text-[#9ca3af]">试试切换状态筛选，或使用更宽泛的关键词</p>
        </div>
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}
