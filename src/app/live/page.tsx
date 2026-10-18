'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Search,
  Radio,
  Newspaper,
  Landmark,
  Flame,
  ExternalLink,
  Inbox,
  RefreshCw,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  Building2,
  Loader2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/components/app/ui-bits';
import type { SourceType } from '@/lib/domain/types';

type Origin = 'remote' | 'cache' | 'fallback';

interface LiveItem {
  externalId: string;
  provider: string;
  sourceType: SourceType;
  sourceName: string;
  title: string;
  content: string;
  url?: string;
  announcementNo?: string;
  disclosedAt: string;
  fetchedAt: string;
  origin?: Origin;
  meta?: { bulletinType?: string; evidenceType?: string };
  /** 服务端主体识别结果：无 subject 的消息不展示（未知主体忽略） */
  subject?: string;
  subjectCode?: string;
  /** 已接入主链路的事件 id（点击直达事件详情） */
  eventId?: string;
}

interface SourceResult {
  provider: string;
  label: string;
  origin: Origin | 'unavailable';
  count: number;
  warning?: string;
}

interface LiveResponse {
  items: LiveItem[];
  count: number;
  subjectCount?: number;
  origin: Origin;
  sources: SourceResult[];
  warnings: string[];
  emptyHint?: string;
  timeRange: { start: string; end: string; usedDefaultWindow: boolean; days: number };
  fetchedAt: string;
}

const DAY_OPTIONS = [
  { value: 1, label: '最近 1 天' },
  { value: 7, label: '最近 7 天' },
  { value: 30, label: '最近 30 天' },
];

function providerMeta(provider: string): { label: string; cls: string; icon: typeof Radio } {
  if (provider === 'cninfo') {
    return { label: '巨潮 cninfo', cls: 'bg-brand/10 text-brand border-brand/30', icon: Landmark };
  }
  if (provider === 'ifind-trending') {
    return { label: 'iFinD 热门', cls: 'bg-orange-50 text-[#EA580C] border-orange-200', icon: Flame };
  }
  if (provider === 'media-kr36') {
    return { label: '36氪', cls: 'bg-[#EBF3FE] text-[#1A6DD9] border-[#B9D6F7]', icon: Newspaper };
  }
  if (provider === 'media-huxiu') {
    return { label: '虎嗅', cls: 'bg-[#FBEFE0] text-[#B45309] border-[#F3D9B0]', icon: Newspaper };
  }
  if (provider === 'media-tmtpost') {
    return { label: '钛媒体', cls: 'bg-[#F0EAFB] text-[#6D28D9] border-[#DACBF5]', icon: Newspaper };
  }
  return { label: 'iFinD 实时', cls: 'bg-blue-50 text-[#2563EB] border-blue-200', icon: Newspaper };
}

function LoadingCards() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="panel p-4">
          <div className="flex items-center gap-2 mb-3">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-5 w-28 rounded" />
            <Skeleton className="h-4 w-12 rounded ml-auto" />
          </div>
          <Skeleton className="h-4 w-4/5 mb-2 rounded" />
          <Skeleton className="h-3 w-full mb-1 rounded" />
          <Skeleton className="h-3 w-2/3 rounded" />
        </div>
      ))}
    </div>
  );
}

/** 按公司归组（未知主体条目忽略不展示） */
interface SubjectGroup {
  subject: string;
  code?: string;
  items: LiveItem[];
  latestAt: string;
}

function groupBySubject(items: LiveItem[]): { groups: SubjectGroup[]; ignored: number } {
  const map = new Map<string, SubjectGroup>();
  let ignored = 0;
  for (const it of items) {
    if (!it.subject) {
      ignored += 1;
      continue;
    }
    const g = map.get(it.subject);
    if (g) {
      g.items.push(it);
      if (it.disclosedAt > g.latestAt) g.latestAt = it.disclosedAt;
      if (!g.code && it.subjectCode) g.code = it.subjectCode;
    } else {
      map.set(it.subject, {
        subject: it.subject,
        code: it.subjectCode,
        items: [it],
        latestAt: it.disclosedAt,
      });
    }
  }
  const groups = [...map.values()].sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  for (const g of groups) g.items.sort((a, b) => b.disclosedAt.localeCompare(a.disclosedAt));
  return { groups, ignored };
}

export default function LivePage() {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [days, setDays] = useState(7);
  const [data, setData] = useState<LiveResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingestingId, setIngestingId] = useState<string | null>(null);
  /** externalId → eventId：本 session 手动接入过的映射 */
  const [ingestedMap, setIngestedMap] = useState<Map<string, string>>(new Map());
  const [ingestError, setIngestError] = useState<string | null>(null);
  const reqSeq = useRef(0);

  const load = useCallback(
    async (overrideQ?: string, overrideDays?: number) => {
      const seq = ++reqSeq.current;
      setLoading(true);
      const daysVal = overrideDays ?? days;
      const qVal = overrideQ ?? q;
      try {
        const res = await fetch('/api/live', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: qVal.trim(), days: daysVal }),
        });
        const json = (await res.json()) as LiveResponse;
        if (seq === reqSeq.current) setData(json);
      } catch {
        if (seq === reqSeq.current) {
          setData({
            items: [],
            count: 0,
            origin: 'fallback',
            sources: [],
            warnings: ['数据服务暂不可用：网络请求失败，请稍后重试。页面不展示任何演示数据。'],
            timeRange: { start: '', end: '', usedDefaultWindow: true, days: daysVal },
            fetchedAt: new Date().toISOString(),
          });
        }
      } finally {
        if (seq === reqSeq.current) setLoading(false);
      }
    },
    [q, days],
  );

  // 首次挂载加载默认 7 天
  useEffect(() => {
    void load('', 7);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitSearch = () => load();

  /** 点击消息卡：已接入 → 直达事件详情；未接入 → 先接入主链路再跳转（下滑可看行情/影响验证） */
  const openEvent = async (item: LiveItem) => {
    const existing = item.eventId ?? ingestedMap.get(item.externalId);
    if (existing) {
      router.push(`/events/${existing}`);
      return;
    }
    setIngestingId(item.externalId);
    setIngestError(null);
    try {
      const res = await fetch('/api/live/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId: item.externalId, mode: 'rules' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? '接入失败');
      const eventId = json.event?.id as string | undefined;
      if (!eventId) throw new Error('接入成功但未返回事件 id');
      setIngestedMap((prev) => new Map(prev).set(item.externalId, eventId));
      router.push(`/events/${eventId}`);
    } catch (err) {
      setIngestError(err instanceof Error ? err.message : '接入失败');
    } finally {
      setIngestingId(null);
    }
  };

  const allFailed = data?.origin === 'fallback';
  const { groups, ignored } = data ? groupBySubject(data.items) : { groups: [], ignored: 0 };

  return (
    <div className="max-w-5xl mx-auto">
      {/* 页头 */}
      <div className="mb-5">
        <div className="flex items-center gap-2.5">
          <span className="flex items-center justify-center w-8 h-8 rounded bg-brand text-white">
            <Radio className="w-4 h-4" />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-ink">实时消息</h1>
            <p className="text-xs text-muted mt-0.5">
              巨潮公告 · 同花顺 iFinD 新闻/热门 · 财经媒体，按公司归组 · 点击消息直达事件监控
            </p>
          </div>
        </div>
      </div>

      {/* 搜索 + 时间窗 */}
      <div className="panel p-4 mb-4">
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-placeholder" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submitSearch()}
              placeholder="搜索最新公告 / 行业消息（公司名、关键词，如：增持、定增、业绩）"
              className="w-full h-10 pl-9 pr-3 text-sm border border-line rounded bg-white focus:outline-none focus:border-brand"
            />
          </div>
          <button
            onClick={submitSearch}
            disabled={loading}
            className="h-10 px-5 text-sm font-medium text-white bg-brand hover:bg-brand-dark rounded disabled:opacity-60"
          >
            实时查询
          </button>
          <button
            onClick={() => load()}
            disabled={loading}
            title="刷新"
            className="h-10 w-10 flex items-center justify-center border border-line rounded text-muted hover:text-brand hover:border-brand disabled:opacity-60"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted">时间窗：</span>
          {DAY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setDays(opt.value);
                load(q, opt.value);
              }}
              className={`h-7 px-3 text-xs rounded border transition-colors ${
                days === opt.value
                  ? 'bg-brand text-white border-brand'
                  : 'bg-white text-secondary border-line hover:border-brand hover:text-brand'
              }`}
            >
              {opt.label}
            </button>
          ))}
          {data && (
            <span className="text-xs text-placeholder font-mono ml-auto">
              {data.timeRange.start} ~ {data.timeRange.end}
            </span>
          )}
        </div>
      </div>

      {/* 数据源状态条 */}
      {data && !loading && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          {data.sources.map((s) => {
            const meta = providerMeta(s.provider);
            return (
              <span
                key={s.provider}
                className={`inline-flex items-center gap-1.5 h-6 px-2 text-[11px] rounded border ${
                  s.origin === 'unavailable'
                    ? 'bg-gray-50 text-placeholder border-line line-through'
                    : meta.cls
                }`}
                title={s.warning ?? meta.label}
              >
                <meta.icon className="w-3 h-3" />
                {meta.label}
                <span className="font-mono">{s.origin === 'unavailable' ? '×' : s.count}</span>
              </span>
            );
          })}
          <span className="text-xs text-muted ml-auto">
            <span className="font-mono font-semibold text-brand">{groups.length}</span> 家公司 ·{' '}
            <span className="font-mono">{groups.reduce((n, g) => n + g.items.length, 0)}</span> 条消息
            {ignored > 0 && <span className="ml-2 text-placeholder">已忽略 {ignored} 条未识别主体资讯</span>}
          </span>
        </div>
      )}

      {/* 内容区 */}
      {loading ? (
        <LoadingCards />
      ) : allFailed ? (
        /* 全部真实源失败：显式提示，绝不展示演示/种子数据 */
        <div className="panel p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-50 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-[#991B1B]" />
          </div>
          <p className="text-sm font-medium text-ink mb-1">数据服务暂不可用</p>
          <p className="text-xs text-muted mb-4">
            所有实时数据源（巨潮资讯网 / 同花顺 iFinD / 财经媒体）当前均未成功，页面不展示任何演示或种子数据。
          </p>
          <div className="max-w-md mx-auto text-left bg-gray-50 border border-line rounded p-3 mb-4">
            {data.warnings.map((w, i) => (
              <p key={i} className="text-[11px] text-secondary font-mono leading-relaxed">
                · {w}
              </p>
            ))}
          </div>
          <button
            onClick={() => load()}
            className="h-9 px-4 text-sm text-white bg-brand hover:bg-brand-dark rounded inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> 重新尝试实时拉取
          </button>
        </div>
      ) : data && (data.count === 0 || groups.length === 0) ? (
        /* 远程成功但无结果/无可识别主体：给调整建议，不回退种子 */
        <div className="panel p-10 text-center">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 flex items-center justify-center">
            <Inbox className="w-6 h-6 text-muted" />
          </div>
          <p className="text-sm font-medium text-ink mb-1">
            {data.count === 0 ? '该时间窗内无匹配的实时消息' : '该时间窗内的消息均无法归属到具体公司主体'}
          </p>
          <p className="text-xs text-muted mb-4 max-w-md mx-auto leading-relaxed">
            {data.count === 0
              ? data.emptyHint
              : '已按规则忽略无法识别主体的资讯。可尝试输入公司名/股票代码精确查询。'}
          </p>
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => {
                setQ('');
                load('', days);
              }}
              className="h-8 px-3 text-xs border border-line rounded text-secondary hover:border-brand hover:text-brand"
            >
              清空关键词看全部
            </button>
            {days !== 30 && (
              <button
                onClick={() => {
                  setDays(30);
                  load(q, 30);
                }}
                className="h-8 px-3 text-xs border border-line rounded text-secondary hover:border-brand hover:text-brand"
              >
                扩大到最近 30 天
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {ingestError && (
            <div className="text-xs text-[#991B1B] bg-red-50 border border-red-200 rounded px-3 py-2">
              接入主链路失败：{ingestError}
            </div>
          )}
          {groups.map((g) => (
            <section key={g.subject} className="panel overflow-hidden">
              {/* 公司组头 */}
              <header className="flex items-center gap-2.5 px-4 py-3 border-b border-line bg-[#FAFBFD]">
                <span className="flex h-7 w-7 items-center justify-center rounded bg-brand/10 text-brand">
                  <Building2 className="w-4 h-4" />
                </span>
                <h2 className="text-sm font-semibold text-ink">{g.subject}</h2>
                {g.code && (
                  <Link
                    href={`/targets/${encodeURIComponent(g.code)}`}
                    className="mono text-[11px] text-brand hover:underline"
                    title="查看标的整合视图"
                  >
                    {g.code}
                  </Link>
                )}
                <span className="ml-auto inline-flex items-center h-5 px-2 text-[11px] rounded border border-line bg-white text-secondary font-mono">
                  {g.items.length} 条
                </span>
              </header>

              {/* 组内消息（点击直达事件监控） */}
              <ul className="divide-y divide-[#EEF0F4]">
                {g.items.map((item) => {
                  const meta = providerMeta(item.provider);
                  const eventId = item.eventId ?? ingestedMap.get(item.externalId);
                  const busy = ingestingId === item.externalId;
                  return (
                    <li key={item.externalId}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => void openEvent(item)}
                        onKeyDown={(e) => e.key === 'Enter' && void openEvent(item)}
                        className="group relative flex items-start gap-3 px-4 py-3 pl-5 cursor-pointer hover:bg-[#FFF7F6] transition-colors"
                      >
                        <span
                          className="absolute left-0 top-0 bottom-0 w-[3px] bg-transparent group-hover:bg-brand transition-colors"
                          style={
                            meta.icon === Landmark ? { background: 'var(--brand)' } : undefined
                          }
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span
                              className={`inline-flex items-center gap-1 h-5 px-1.5 text-[10px] rounded border ${meta.cls}`}
                            >
                              <meta.icon className="w-3 h-3" />
                              {meta.label}
                            </span>
                            {eventId && (
                              <span className="inline-flex items-center gap-0.5 h-5 px-1.5 text-[10px] text-[#0DA678]">
                                <CheckCircle2 className="w-3 h-3" /> 已接入
                              </span>
                            )}
                            <span className="ml-auto text-[11px] text-placeholder font-mono shrink-0">
                              {formatDateTime(item.disclosedAt)}
                            </span>
                          </div>
                          <h3 className="text-[13px] font-medium text-ink leading-snug mb-0.5 group-hover:text-brand transition-colors">
                            {item.title}
                          </h3>
                          <p className="text-xs text-muted leading-relaxed line-clamp-1">{item.content}</p>
                        </div>
                        <span className="shrink-0 self-center text-placeholder group-hover:text-brand transition-colors">
                          {busy ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </span>
                        {item.url && (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="shrink-0 self-center text-placeholder hover:text-brand"
                            title="查看原文"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
