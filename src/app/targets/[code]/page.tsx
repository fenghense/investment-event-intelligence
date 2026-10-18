'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { InvestmentEvent, RelatedTarget, Target } from '@/lib/domain/types';
import type { KlinePoint, MarketOrigin, TargetImpact } from '@/lib/adapters/fuyao/marketAdapter';
import { ACTION_LABELS, TARGET_ROLE_LABELS } from '@/lib/domain/vocabulary';
import { CredibilityBar, StatusSeal, formatDateTime } from '@/components/app/ui-bits';

interface TargetDetailResponse {
  target: Target;
  events: Array<InvestmentEvent & { evidenceCount: number }>;
  market: {
    origin: MarketOrigin;
    quote: { code: string; name: string; price: number; pctChange: number; updatedAt: string } | null;
    kline: KlinePoint[];
    warnings: string[];
  };
  impacts: Record<string, TargetImpact>;
  profile: { text: string; source: string } | null;
}

const ORIGIN_BADGE: Record<MarketOrigin, { label: string; cls: string }> = {
  ifind: { label: 'iFinD 实时行情', cls: 'bg-[#FDEDEC] text-[#D93025] border-[#D93025]/30' },
  fuyao: { label: '扶摇实时行情', cls: 'bg-[#FDEDEC] text-[#D93025] border-[#D93025]/30' },
  fallback: { label: '演示降级行情', cls: 'bg-[#f3f4f6] text-[#6b7280] border-[#e5e7eb]' },
};

function pctColor(v: number | null): string {
  if (v == null) return 'text-[#6b7280]';
  if (v > 0) return 'text-[#D93025]';
  if (v < 0) return 'text-[#0DA678]';
  return 'text-[#6b7280]';
}

function fmtPct(v: number | null, withSign = true): string {
  if (v == null) return '—';
  return `${withSign && v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** 近期走势迷你图（红涨绿跌，SVG 折线） */
function MiniTrend({ kline }: { kline: KlinePoint[] }) {
  const points = useMemo(() => {
    if (kline.length < 2) return '';
    const w = 560;
    const h = 96;
    const closes = kline.map((k) => k.close);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || 1;
    return kline
      .map((k, i) => {
        const x = (i / (kline.length - 1)) * w;
        const y = h - 6 - ((k.close - min) / span) * (h - 12);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [kline]);
  if (!points) return <div className="py-6 text-center text-xs text-[#9ca3af]">暂无走势数据</div>;
  const up = kline[kline.length - 1].close >= kline[0].close;
  const stroke = up ? '#D93025' : '#0DA678';
  return (
    <svg viewBox="0 0 560 96" className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="近期走势">
      <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.6" />
      <circle
        cx="560"
        cy={points.split(' ').pop()?.split(',')[1] ?? 48}
        r="2.6"
        fill={stroke}
      />
    </svg>
  );
}

function ImpactLine({ impact }: { impact: TargetImpact }) {
  if (!impact.eventDate) {
    return <span className="text-[11px] text-[#9ca3af]">影响验证：事件时间未定，暂无法定位行情窗口</span>;
  }
  if (impact.eventDayPct == null) {
    return (
      <span className="text-[11px] text-[#9ca3af]">
        影响验证：{impact.eventDate} 窗口内无有效行情数据
      </span>
    );
  }
  return (
    <span className="mono flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
      <span className="text-[#6b7280]">事件日 {impact.eventDate}</span>
      <span className={pctColor(impact.eventDayPct)}>当日 {fmtPct(impact.eventDayPct)}</span>
      {impact.nextDayPct != null && <span className={pctColor(impact.nextDayPct)}>次日 {fmtPct(impact.nextDayPct)}</span>}
      {impact.volumeRatio != null && (
        <span className={impact.volumeRatio >= 2 ? 'text-[#D93025]' : 'text-[#6b7280]'}>量比 {impact.volumeRatio}x</span>
      )}
      {impact.windowPct != null && <span className={pctColor(impact.windowPct)}>区间 {fmtPct(impact.windowPct)}</span>}
      {impact.anomaly && (
        <span className="rounded border border-[#D93025]/40 bg-[#FDEDEC] px-1 py-px text-[10px] font-semibold text-[#D93025]">
          量价异动
        </span>
      )}
    </span>
  );
}

export default function TargetDetailPage() {
  const params = useParams<{ code: string }>();
  const [data, setData] = useState<TargetDetailResponse | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const res = await fetch(`/api/targets/${params.code}`, { cache: 'no-store' });
      if (res.status === 404) {
        if (!cancelled) setNotFound(true);
        return;
      }
      const json = (await res.json()) as TargetDetailResponse;
      if (!cancelled) setData(json);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [params.code]);

  if (notFound) {
    return (
      <div className="py-24 text-center">
        <p className="text-[#6b7280]">标的不存在</p>
        <Link href="/" className="mt-3 inline-block text-sm text-[#d93025] hover:underline">
          返回首页搜索
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4 py-6">
        <div className="h-40 animate-pulse rounded-md bg-[#eef0f5]" />
        <div className="h-28 animate-pulse rounded-md bg-[#eef0f5]" />
        <div className="h-28 animate-pulse rounded-md bg-[#eef0f5]" />
      </div>
    );
  }

  const { target, events, market, impacts, profile } = data;
  const badge = ORIGIN_BADGE[market.origin];
  const relatedOthers = Array.from(
    new Map(
      events
        .flatMap((e) => e.targets)
        .filter((t) => t.code !== target.code && t.name !== '未指明')
        .map((t) => [t.code, t]),
    ).values(),
  );

  return (
    <div className="space-y-4">
      {/* 左上角：直接返回主页 */}
      <div className="flex items-center justify-between">
        <Link href="/" className="mono text-xs text-[#6b7280] transition-colors hover:text-[#d93025]">
          ← 返回首页
        </Link>
        <Link href="/events" className="mono text-xs text-[#6b7280] transition-colors hover:text-[#d93025]">
          事件监控 →
        </Link>
      </div>

      {/* 标的信息卡：登记信息 + 行情快照 + 近期走势 */}
      <section className="paper-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[#1f2329]">{target.name}</h1>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${badge.cls}`}>{badge.label}</span>
            </div>
            <div className="mono mt-1 text-xs text-[#6b7280]">
              {target.code} · {target.market} · {target.industry}
              {target.industry === '待识别' && <span className="ml-1 text-[#9ca3af]">（行业信息待 iFinD 概况补全）</span>}
            </div>
          </div>
          {market.quote && (
            <div className="text-right">
              <div className={`mono text-2xl font-bold ${pctColor(market.quote.pctChange)}`}>
                {market.quote.price.toFixed(2)}
              </div>
              <div className={`mono text-[13px] ${pctColor(market.quote.pctChange)}`}>
                {fmtPct(market.quote.pctChange)}
              </div>
              <div className="mono mt-0.5 text-[10px] text-[#9ca3af]">
                更新 {market.quote.updatedAt.slice(0, 10)} 收盘
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 border-t border-[#e5e7eb] pt-3">
          <div className="mb-1 flex items-center justify-between text-[11px] text-[#9ca3af]">
            <span>近期走势（近 {market.kline.length} 个交易日）</span>
            {market.kline.length > 1 && (
              <span className="mono">
                区间{' '}
                <b className={pctColor(
                  ((market.kline[market.kline.length - 1].close - market.kline[0].close) / market.kline[0].close) * 100,
                )}>
                  {fmtPct(((market.kline[market.kline.length - 1].close - market.kline[0].close) / market.kline[0].close) * 100)}
                </b>
              </span>
            )}
          </div>
          <MiniTrend kline={market.kline} />
        </div>
        {market.warnings.length > 0 && (
          <p className="mt-2 text-[11px] text-[#9ca3af]">{market.warnings.join('；')}</p>
        )}
      </section>

      {/* iFinD 标的概况（行业/板块/主营） */}
      {profile && (
        <section className="paper-card p-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1f2329]">标的概况 · 行业与板块</h2>
            <span className="rounded border border-[#D93025]/30 bg-[#FDEDEC] px-1.5 py-0.5 text-[10px] text-[#D93025]">
              {profile.source}
            </span>
          </div>
          <div className="overflow-x-auto text-[12px] leading-relaxed whitespace-pre-wrap text-[#4b5563]">
            {profile.text}
          </div>
        </section>
      )}

      {/* 事件涉及的其他标的（股票/主体） */}
      {relatedOthers.length > 0 && (
        <section className="paper-card p-4">
          <h2 className="mb-2 text-sm font-semibold text-[#1f2329]">事件涉及标的</h2>
          <div className="flex flex-wrap gap-2">
            {relatedOthers.map((t: RelatedTarget) => (
              <Link
                key={t.code}
                href={`/targets/${encodeURIComponent(t.code)}`}
                className="rounded border border-[#e5e7eb] px-2 py-1 text-xs text-[#4b5563] transition-colors hover:border-[#d93025] hover:text-[#d93025]"
              >
                {t.name}
                <span className="mono ml-1 text-[10px] text-[#9ca3af]">
                  {TARGET_ROLE_LABELS[t.role]}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 关联事件时间线 + 影响验证 */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#1f2329]">
            关联事件时间线 <span className="mono ml-1 text-xs text-[#9ca3af]">{events.length} 个</span>
          </h2>
          <span className="text-[11px] text-[#9ca3af]">按事件窗口验证量价异动（|涨跌|≥3% 或量比≥2）</span>
        </div>
        {events.length === 0 && (
          <div className="paper-card py-16 text-center text-sm text-[#6b7280]">
            该标的暂无关联事件
            <div className="mt-2 text-xs text-[#9ca3af]">回首页搜索公司名，实时检索后自动接入事件监控</div>
          </div>
        )}
        <ol className="relative ml-2 space-y-4 border-l-2 border-[#e5e7eb] pl-5">
          {events.map((event) => {
            const relation = event.targets.find((t: RelatedTarget) => t.code === target.code);
            const impact = impacts[event.id];
            return (
              <li key={event.id} className="relative">
                <span className="absolute top-4 -left-[27px] h-3 w-3 rounded-full border-2 border-white bg-[#d93025]" />
                <Link href={`/events/${event.id}`} className="block">
                  <article className="paper-card paper-card-hover p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusSeal status={event.status} />
                      <h3 className="text-[15px] font-semibold text-[#1f2329]">{event.title}</h3>
                      {relation && (
                        <span className="rounded bg-[#f3f4f6] px-1.5 py-0.5 text-[11px] text-[#6b7280]">
                          本标的：{TARGET_ROLE_LABELS[relation.role]}
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
                      <span>证据 {event.evidenceCount} 条</span>
                      <span className="mono text-[11px]">更新 {formatDateTime(event.updatedAt)}</span>
                      <span className="ml-auto">
                        <CredibilityBar score={event.credibilityScore} level={event.credibility} compact />
                      </span>
                    </div>
                    {/* 事件涉及标的 */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {event.targets
                        .filter((t) => t.name !== '未指明')
                        .map((t) => (
                          <span
                            key={`${event.id}-${t.code}`}
                            className="rounded border border-[#e5e7eb] px-1.5 py-px text-[10px] text-[#6b7280]"
                          >
                            {t.name}·{TARGET_ROLE_LABELS[t.role]}
                          </span>
                        ))}
                    </div>
                    {impact && (
                      <div className="mt-2 border-t border-dashed border-[#e5e7eb] pt-2">
                        <ImpactLine impact={impact} />
                      </div>
                    )}
                  </article>
                </Link>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
