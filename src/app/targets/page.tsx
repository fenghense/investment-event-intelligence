'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { EventStatus, Target } from '@/lib/domain/types';
import { PageHeader, StatusGroupChip } from '@/components/app/ui-bits';

type TargetWithStats = Target & {
  eventCount: number;
  activeEventCount: number;
  statusBreakdown: Partial<Record<EventStatus, number>>;
};

const STATUS_ORDER: EventStatus[] = ['published', 'updated', 'corrected', 'denied', 'expired', 'revived'];

export default function TargetsPage() {
  const [targets, setTargets] = useState<TargetWithStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const res = await fetch('/api/targets', { cache: 'no-store' });
        const data = (await res.json()) as { targets: TargetWithStats[] };
        if (!cancelled) setTargets(data.targets);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader title="标的维度" en="Watchlist by Target" />
      <p className="-mt-3 mb-5 text-[13px] text-[#6b7280]">
        按标的聚合关联事件，快速定位每个标的的活跃情报与状态分布。
      </p>

      {loading ? (
        <div className="py-16 text-center text-sm text-[#6b7280]">加载中…</div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {targets.map((t) => (
            <Link key={t.code} href={`/targets/${t.code}`} className="block">
              <article className="paper-card paper-card-hover flex h-full flex-col p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-[16px] font-semibold text-[#1f2329]">{t.name}</h3>
                    <div className="mono mt-0.5 text-[11px] text-[#6b7280]">
                      {t.code} · {t.market} · {t.industry}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="mono text-[22px] font-semibold leading-none text-[#d93025]">
                      {t.eventCount}
                    </div>
                    <div className="mt-1 text-[10.5px] text-[#6b7280]">关联事件</div>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {STATUS_ORDER.filter((s) => (t.statusBreakdown[s] ?? 0) > 0).map((s) => (
                    <span key={s} className="flex items-center gap-1">
                      <StatusGroupChip status={s} />
                      <span className="mono text-[11px] text-[#6b7280]">×{t.statusBreakdown[s]}</span>
                    </span>
                  ))}
                  {t.eventCount === 0 && <span className="text-xs text-[#9ca3af]">暂无关联事件</span>}
                </div>

                <div className="mono mt-auto pt-3 text-[10px] uppercase tracking-wider text-[#9ca3af]">
                  活跃 {t.activeEventCount} · 查看事件列表 →
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
