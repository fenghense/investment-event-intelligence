'use client';

import Link from 'next/link';
import type { InvestmentEvent } from '@/lib/domain/types';
import { ACTION_LABELS, STATUS_GROUP_LABELS } from '@/lib/domain/vocabulary';
import { CredibilityBar, StatusSeal, formatDateTime } from '@/components/app/ui-bits';
import { FavoriteButton } from '@/components/app/favorite-button';

export type EventCardData = InvestmentEvent & { evidenceCount: number };

// 事件卡片（热点事件/事件监控列表共用）：固定信息位 + 右上角收藏星标
export function EventCard({ event }: { event: EventCardData }) {
  return (
    <Link href={`/events/${event.id}`} className="block">
      <article className="paper-card paper-card-hover relative p-4">
        {/* 右上角收藏 */}
        <div className="absolute right-3 top-3">
          <FavoriteButton eventId={event.id} favorited={event.favorited ?? false} />
        </div>

        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1 pr-9">
            <div className="flex flex-wrap items-center gap-2">
              <StatusSeal status={event.status} />
              <h3 className="text-[15px] font-semibold text-[#1f2329]">{event.title}</h3>
              {event.hasDenialRecord && (
                <span className="seal seal-hollow" style={{ color: '#991b1b', borderColor: '#991b1b' }}>
                  曾有否认记录
                </span>
              )}
            </div>
            <p className="mt-1.5 line-clamp-1 text-[13px] text-[#6b7280]">最新：{event.summary}</p>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[#6b7280]">
              <span className="mono text-[11px]">
                {event.subject}
                <span className="mx-1 text-[#d93025]">→{ACTION_LABELS[event.action]}→</span>
                {event.object}
              </span>
              <span className="flex items-center gap-1">
                关联标的：
                {event.targets.slice(0, 3).map((t) => (
                  <span
                    key={t.code}
                    className="mono rounded bg-[#f3f4f6] px-1.5 py-0.5 text-[10.5px] text-[#4b5563]"
                  >
                    {t.name} {t.code}
                  </span>
                ))}
              </span>
              <span>证据 {event.evidenceCount} 条</span>
              <span className="mono text-[11px]">更新 {formatDateTime(event.updatedAt)}</span>
            </div>
          </div>

          <div className="shrink-0 pt-8">
            <CredibilityBar score={event.credibilityScore} level={event.credibility} compact />
            <div className="mono mt-2 text-right text-[10px] uppercase tracking-wider text-[#9ca3af]">
              {STATUS_GROUP_LABELS[event.status]}
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
