'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import type { InvestmentEvent, RelatedTarget, Target } from '@/lib/domain/types';
import { ACTION_LABELS } from '@/lib/domain/vocabulary';
import { CredibilityBar, StatusSeal, formatDateTime } from '@/components/app/ui-bits';
import { FavoriteButton } from '@/components/app/favorite-button';

interface LiveReport {
  ingested: number;
  fetched: number;
  skipped: number;
  errors: string[];
  sources: { key: string; status: 'ok' | 'empty' | 'failed'; count: number; error?: string }[];
}

type SearchEvent = InvestmentEvent & { sourceNames?: string[] };

interface SearchResponse {
  q: string;
  targets: Target[];
  events: SearchEvent[];
  suggestions: string[];
  emptyHints?: string[];
  live?: LiveReport;
}

const SOURCE_BADGES: Record<string, { label: string; cls: string }> = {
  cninfo: { label: '巨潮', cls: 'border-[#d93025]/40 bg-[#fdedec] text-[#d93025]' },
  ifind: { label: 'iFinD 实时', cls: 'border-[#991b1b]/40 bg-[#991b1b]/5 text-[#991b1b]' },
  media: { label: '财经媒体', cls: 'border-[#2563eb]/40 bg-[#2563eb]/5 text-[#2563eb]' },
};

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') ?? '';
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveState, setLiveState] = useState<'idle' | 'loading' | 'done'>('idle');

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      setLoading(true);
      setLiveState('idle');
      setData(null);
      // 第一段：本地库快速返回
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
        const json = (await res.json()) as SearchResponse;
        if (cancelled) return;
        setData(json);
        setLoading(false);
      } catch {
        if (!cancelled) setLoading(false);
      }
      if (cancelled || !q) return;
      // 第二段：实时检索全网最新资讯（巨潮 / iFinD / 财经媒体）并接入主链路
      setLiveState('loading');
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&live=1`, { cache: 'no-store' });
        const json = (await res.json()) as SearchResponse;
        if (!cancelled) {
          setData(json);
          setLiveState('done');
        }
      } catch {
        if (!cancelled) setLiveState('done');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [q]);

  if (loading) return <SearchSkeleton />;

  const targets = data?.targets ?? [];
  const events = data?.events ?? [];
  const empty = targets.length === 0 && events.length === 0;
  const live = data?.live;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[20px] font-bold text-[#1f2329]">
          “{q}” <span className="text-[14px] font-normal text-[#9ca3af]">的搜索结果</span>
        </h1>
        <p className="mono mt-1 text-[12px] text-[#9ca3af]">
          命中标的 {targets.length} · 事件 {events.length}
        </p>
      </div>

      {/* 实时检索状态条：检索中骨架 → 完成后来源徽标汇总 */}
      {liveState === 'loading' && (
        <div className="mb-4 flex animate-pulse items-center gap-2 rounded-md border border-[#e5e7eb] bg-white px-4 py-2.5 text-[12px] text-[#6b7280]">
          <span className="h-2 w-2 animate-ping rounded-full bg-[#d93025]" />
          正在实时检索全网最新资讯（巨潮 / iFinD / 财经媒体，最近 30 天）并梳理为事件卡片…
        </div>
      )}
      {liveState === 'done' && live && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-[#e5e7eb] bg-white px-4 py-2.5 text-[12px] text-[#6b7280]">
          <span className="font-medium text-[#1f2329]">实时检索完成</span>
          {live.sources.map((s) => {
            const badge = SOURCE_BADGES[s.key] ?? { label: s.key, cls: 'border-[#e5e7eb] bg-[#f5f6fa] text-[#6b7280]' };
            return (
              <span key={s.key} className={`rounded border px-1.5 py-0.5 text-[11px] ${badge.cls}`} title={s.error}>
                {badge.label} {s.status === 'failed' ? '不可用' : `${s.count} 条`}
              </span>
            );
          })}
          <span className="mono text-[11px] text-[#9ca3af]">
            拉取 {live.fetched} · 新建事件 {live.ingested} · 合并入既有时间线{' '}
            {live.fetched - live.ingested - live.skipped > 0 ? live.fetched - live.ingested - live.skipped : 0}
            {live.skipped > 0 ? ` · 跳过 ${live.skipped}（无法识别主体的散文资讯）` : ''}
          </span>
        </div>
      )}

      {empty && liveState !== 'done' ? (
        <div className="paper-card mx-auto max-w-xl animate-pulse p-8 text-center text-[13px] text-[#6b7280]">
          本地未收录“{q}”，正在全网实时检索最新公告与资讯…
        </div>
      ) : empty ? (
        <EmptyState q={q} hints={data?.emptyHints ?? []} suggestions={data?.suggestions ?? []} />
      ) : (
        <div className="space-y-6">
          {targets.length > 0 && (
            <section>
              <SectionTitle>关联标的</SectionTitle>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {targets.map((t) => (
                  <Link
                    key={t.code}
                    href={`/targets/${t.code}`}
                    className="paper-card group flex items-center justify-between p-4"
                  >
                    <div>
                      <div className="text-[15px] font-semibold text-[#1f2329] group-hover:text-[#d93025]">
                        {t.name}
                        <span className="mono ml-2 text-[12px] font-normal text-[#9ca3af]">{t.code}</span>
                      </div>
                      {t.aliases && t.aliases.length > 0 && (
                        <div className="mt-1 text-[12px] text-[#9ca3af]">别名：{t.aliases.join(' / ')}</div>
                      )}
                    </div>
                    <span className="text-[12px] text-[#9ca3af] transition-transform group-hover:translate-x-0.5">→</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {events.length > 0 && (
            <section>
              <SectionTitle>关联事件</SectionTitle>
              <div className="space-y-3">
                {events.map((e) => (
                  <Link key={e.id} href={`/events/${e.id}`} className="paper-card group block p-4">
                    <div className="flex items-center gap-3">
                      <StatusSeal status={e.status} />
                      <span className="mono text-[11px] text-[#9ca3af]">
                        {ACTION_LABELS[e.action] ?? e.action}
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="mono text-[11px] text-[#9ca3af]">
                          更新 {formatDateTime(e.updatedAt)}
                        </span>
                        <FavoriteButton eventId={e.id} favorited={e.favorited ?? false} size="sm" />
                      </span>
                    </div>
                    <div className="mt-2 text-[15px] font-semibold leading-snug text-[#1f2329] group-hover:text-[#d93025]">
                      {e.title}
                    </div>
                    <div className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-[#6b7280]">{e.summary}</div>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <CredibilityBar level={e.credibility} score={e.credibilityScore} />
                      {(e.sourceNames ?? []).slice(0, 3).map((s) => (
                        <span
                          key={s}
                          className="rounded border border-[#d93025]/25 bg-[#fdedec] px-1.5 py-0.5 text-[11px] text-[#d93025]"
                        >
                          {s}
                        </span>
                      ))}
                      <div className="ml-auto flex gap-1.5">
                        {e.targets.map((t: RelatedTarget) => (
                          <span
                            key={t.code}
                            className="mono rounded border border-[#e5e7eb] bg-[#f5f6fa] px-1.5 py-0.5 text-[11px] text-[#6b7280]"
                          >
                            {t.name} {t.code}
                          </span>
                        ))}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {/* 有结果但仍给出相关词，引导继续探索 */}
      {!empty && (data?.suggestions?.length ?? 0) > 0 && (
        <div className="mt-8 flex items-center gap-2 text-[12px] text-[#9ca3af]">
          相关搜索：
          {data!.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => router.push(`/search?q=${encodeURIComponent(s)}`)}
              className="rounded-full border border-[#e5e7eb] bg-white px-3 py-1 text-[12px] text-[#6b7280] transition-colors hover:border-[#d93025] hover:text-[#d93025]"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 text-[14px] font-semibold text-[#1f2329]">
      <span className="h-3.5 w-0.5 rounded-full bg-[#d93025]" />
      {children}
    </h2>
  );
}

function EmptyState({ q, hints, suggestions }: { q: string; hints: string[]; suggestions: string[] }) {
  const router = useRouter();
  return (
    <div className="paper-card mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#f5f6fa] text-[22px] text-[#9ca3af]">
        ?
      </div>
      <div className="text-[15px] font-semibold text-[#1f2329]">未找到与“{q}”相关的事件</div>
      <div className="mt-3 space-y-1.5 text-left">
        <div className="text-[12px] font-medium text-[#9ca3af]">可能原因：</div>
        {(hints.length > 0 ? hints : ['标的不存在或未收录', '时间范围内无披露', '试试更宽泛的关键词']).map((h) => (
          <div key={h} className="flex items-start gap-2 text-[13px] text-[#6b7280]">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#d93025]" />
            {h}
          </div>
        ))}
      </div>
      {suggestions.length > 0 && (
        <div className="mt-5 border-t border-[#e5e7eb] pt-4">
          <div className="mb-2 text-[12px] text-[#9ca3af]">建议搜索词：</div>
          <div className="flex flex-wrap justify-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => router.push(`/search?q=${encodeURIComponent(s)}`)}
                className="rounded-full border border-[#d93025]/30 bg-[#d93025]/5 px-3.5 py-1.5 text-[13px] text-[#d93025] transition-colors hover:bg-[#d93025] hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SearchSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="mb-2 h-6 w-64 rounded bg-[#eceef3]" />
      <div className="mb-6 h-4 w-40 rounded bg-[#eceef3]" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="paper-card mb-3 p-4">
          <div className="flex items-center gap-3">
            <div className="h-5 w-16 rounded-full bg-[#eceef3]" />
            <div className="h-4 w-12 rounded bg-[#eceef3]" />
            <div className="ml-auto h-3 w-28 rounded bg-[#eceef3]" />
          </div>
          <div className="mt-3 h-5 w-3/4 rounded bg-[#eceef3]" />
          <div className="mt-2 h-4 w-full rounded bg-[#eceef3]" />
          <div className="mt-2 h-4 w-2/3 rounded bg-[#eceef3]" />
        </div>
      ))}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<SearchSkeleton />}>
      <SearchInner />
    </Suspense>
  );
}
