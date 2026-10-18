'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactElement } from 'react';
import { SOURCE_TYPE_LABELS } from '@/lib/domain/vocabulary';

interface IfindRawItem {
  externalId: string;
  sourceType: keyof typeof SOURCE_TYPE_LABELS;
  sourceName: string;
  title: string;
  content: string;
  url?: string;
  announcementNo?: string;
  disclosedAt: string;
  fetchedAt: string;
  origin?: 'remote' | 'cache' | 'fallback';
  meta?: { bulletinType?: string };
}

interface FetchWarning {
  stage: string;
  origin: 'remote' | 'cache' | 'fallback';
  message: string;
}

interface IngestSummary {
  externalId: string;
  eventId: string;
  eventTitle: string;
  status: string;
  matchType: string;
  credibility: string;
  warnings: string[];
}

interface FetchResponse {
  configured: boolean;
  query: string;
  timeRange: { start: string; end: string; usedDefaultWindow?: boolean };
  origin: 'remote' | 'cache' | 'fallback';
  warnings: FetchWarning[];
  sources: Array<{ tool: string; origin: string; count: number }>;
  quota: { mcpCalls: number };
  count: number;
  items: IfindRawItem[];
  ingestResults?: IngestSummary[];
  emptyHint?: string;
  error?: string;
}

interface QuotaResponse {
  configured: boolean;
  mcpCalls: number;
}

const PRESET_QUERIES = ['光迅科技', '恒远能源', '明州智能', '蓝湾生物'];

const ORIGIN_LABEL: Record<string, { text: string; cls: string }> = {
  remote: { text: 'iFinD 实时', cls: 'bg-[#fdecec] text-[#c12a26] border-[#f3c2c0]' },
  cache: { text: '缓存命中', cls: 'bg-[#f6f5f0] text-[#6b7280] border-[#e5e7eb]' },
  fallback: { text: '演示降级', cls: 'bg-[#fef3c7] text-[#8a6a1f] border-[#e8d9ac]' },
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MATCH_LABEL: Record<string, string> = {
  exact: '精确合并',
  fuzzy: '近似合并',
  deny_ref: '否认回溯',
  reactivate: '重新激活',
  new: '新建事件',
};

function SkeletonCard(): ReactElement {
  return (
    <div className="animate-pulse rounded-md border border-[#e5e7eb] bg-white p-3.5">
      <div className="mb-2 h-3 w-32 rounded bg-[#ece9e0]" />
      <div className="mb-2 h-4 w-3/4 rounded bg-[#f3f4f6]" />
      <div className="h-3 w-full rounded bg-[#f5f4ee]" />
    </div>
  );
}

export function IfindPanel(): ReactElement {
  const today = new Date().toISOString().slice(0, 10);
  const halfYearAgo = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);

  const [query, setQuery] = useState('光迅科技');
  const [timeStart, setTimeStart] = useState(halfYearAgo);
  const [timeEnd, setTimeEnd] = useState(today);
  const [size, setSize] = useState(5);
  const [autoIngest, setAutoIngest] = useState(false);
  const [mode, setMode] = useState<'rules' | 'llm'>('rules');
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FetchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<QuotaResponse | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch('/api/ifind/quota')
      .then((r) => r.json() as Promise<QuotaResponse>)
      .then(setQuota)
      .catch(() => undefined);
  }, [data]);

  const run = async (): Promise<void> => {
    if (!query.trim()) {
      setError('请输入标的名称 / 代码 / 关键词');
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch('/api/ifind/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), timeStart, timeEnd, size, ingest: autoIngest, mode }),
      });
      const json = (await res.json()) as FetchResponse;
      if (!res.ok) {
        setError(json.error ?? '拉取失败');
      } else {
        setData(json);
        setQuota({ configured: json.configured, mcpCalls: json.quota.mcpCalls });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  const originBadge = data ? ORIGIN_LABEL[data.origin] : null;

  return (
    <div className="space-y-4">
      {/* 查询条件卡片 */}
      <section className="paper-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-[#1f2329]">标的 / 关键词</span>
          {PRESET_QUERIES.map((q) => (
            <button
              key={q}
              onClick={() => setQuery(q)}
              className={`rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors ${
                query === q
                  ? 'border-[#c12a26] bg-[#fdecec] text-[#c12a26]'
                  : 'border-[#e5e7eb] bg-white text-[#6b7280] hover:border-[#c12a26]'
              }`}
            >
              {q}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && run()}
          placeholder="输入标的名称、股票代码或事件关键词，如：光迅科技"
          className="w-full rounded-md border border-[#e5e7eb] bg-white px-3 py-2 text-[14px] outline-none focus:border-[#c12a26]"
        />
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs text-[#6b7280]">开始日期</span>
            <input
              type="date"
              value={timeStart}
              onChange={(e) => setTimeStart(e.target.value)}
              className="w-full rounded-md border border-[#e5e7eb] bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-[#c12a26]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[#6b7280]">结束日期</span>
            <input
              type="date"
              value={timeEnd}
              onChange={(e) => setTimeEnd(e.target.value)}
              className="w-full rounded-md border border-[#e5e7eb] bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-[#c12a26]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[#6b7280]">每源条数（额度保护）</span>
            <select
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              className="w-full rounded-md border border-[#e5e7eb] bg-white px-2 py-1.5 text-[12.5px] outline-none focus:border-[#c12a26]"
            >
              {[3, 5, 10, 20].map((n) => (
                <option key={n} value={n}>
                  {n} 条
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-[#6b7280]">拉取后接入主链路</span>
            <div className="flex overflow-hidden rounded-md border border-[#e5e7eb]">
              <button
                onClick={() => setAutoIngest(false)}
                className={`flex-1 px-2 py-1.5 text-[12px] ${!autoIngest ? 'bg-[#c12a26] text-white' : 'bg-white text-[#6b7280]'}`}
              >
                仅拉取
              </button>
              <button
                onClick={() => setAutoIngest(true)}
                className={`flex-1 px-2 py-1.5 text-[12px] ${autoIngest ? 'bg-[#c12a26] text-white' : 'bg-white text-[#6b7280]'}`}
              >
                抽取去重
              </button>
            </div>
          </label>
        </div>
        {autoIngest && (
          <div className="mt-2 text-[12px] text-[#6b7280]">
            抽取方式：
            <label className="ml-2 inline-flex items-center gap-1">
              <input type="radio" checked={mode === 'rules'} onChange={() => setMode('rules')} /> 规则
            </label>
            <label className="ml-3 inline-flex items-center gap-1">
              <input type="radio" checked={mode === 'llm'} onChange={() => setMode('llm')} /> 大模型语义
            </label>
          </div>
        )}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={run}
            disabled={loading}
            className="rounded-md bg-[#c12a26] px-5 py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-[#a82420] disabled:opacity-50"
          >
            {loading ? '正在拉取…' : '从 iFinD 实时拉取'}
          </button>
          <span className="text-[11.5px] text-[#6b7280]">
            凭证状态：
            <b className={quota?.configured ? 'text-[#0da678]' : 'text-[#d97706]'}>
              {quota?.configured ? '已配置' : '未配置（将降级）'}
            </b>
            {' · '}本进程 MCP 调用：<span className="mono">{quota?.mcpCalls ?? 0}</span> 次（公告缓存 24h / 新闻 12h）
          </span>
        </div>
        {error && <p className="mt-2 text-xs text-[#991b1b]">{error}</p>}
      </section>

      {/* 结果区 */}
      {loading && (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && data && (
        <>
          {/* 来源与降级链总览 */}
          <section className="paper-card flex flex-wrap items-center gap-3 p-3.5 text-[12px]">
          {originBadge && (
            <span className={`rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium ${originBadge.cls}`}>
              {originBadge.text}
            </span>
          )}
          <span className="text-[#6b7280]">
            共 <b className="mono text-[#1f2329]">{data.count}</b> 条 · 查询窗口 {data.timeRange.start} ~ {data.timeRange.end}
            {data.timeRange.usedDefaultWindow && <span className="ml-1 text-[11px] text-[#9ca3af]">（默认最近半年）</span>}
          </span>
          {data.sources.map((s) => (
            <span key={s.tool} className="mono text-[11px] text-[#6b7280]">
              {s.tool}：{ORIGIN_LABEL[s.origin]?.text ?? s.origin} {s.count}
            </span>
          ))}
          {data.origin === 'fallback' && (
            <span className="text-[11.5px] text-[#d97706]">数据服务暂不可用，以下为本地演示降级数据（已显式标记）</span>
          )}
          </section>

          {data.warnings.length > 0 && (
            <section className="rounded-md border border-[#e8d9ac] bg-[#fef3c7] px-3.5 py-2.5 text-[12px] text-[#92400e]">
              {data.warnings.map((w, i) => (
                <div key={i}>· {w.message}</div>
              ))}
            </section>
          )}

          {/* 接入主链路结果 */}
          {data.ingestResults && data.ingestResults.length > 0 && (
            <section className="paper-card p-3.5">
              <div className="mb-2 text-[13px] font-semibold text-[#1f2329]">已接入情报主链路</div>
              <div className="space-y-1.5">
                {data.ingestResults.map((r) => (
                  <div key={r.externalId} className="flex flex-wrap items-center gap-2 text-[12px]">
                    <span className="rounded bg-[#f6f5f0] px-1.5 py-0.5 text-[11px] text-[#6b7280]">
                      {MATCH_LABEL[r.matchType] ?? r.matchType}
                    </span>
                    <Link href={`/events/${r.eventId}`} className="font-medium text-[#c12a26] hover:underline">
                      {r.eventTitle}
                    </Link>
                    <span className="mono text-[11px] text-[#6b7280]">可信度 {r.credibility} · {r.status}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 证据卡片 */}
          <section className="space-y-3">
            {data.items.length === 0 ? (
              <div className="paper-card p-6">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-[#fef3c7] text-[12px] font-bold text-[#b45309]">!</span>
                  <div className="text-[13px] leading-relaxed text-[#4b5563]">
                    {data.origin === 'fallback' ? (
                      <>
                        <p className="font-semibold text-[#92400e]">iFinD 数据服务暂不可用，且本地无匹配演示数据</p>
                        <p className="mt-1 text-[12.5px] text-[#6b7280]">
                          凭证未配置或实时调用失败。下方不展示任何种子/演示数据（避免伪造实时结果），请稍后重试或检查 <span className="mono">IFIND_MCP_URL / IFIND_API_TOKEN</span> 配置。
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="font-semibold text-[#1f2329]">
                          iFinD 实时查询成功，但该时间窗（{data.timeRange.start} ~ {data.timeRange.end}）内无匹配公告/新闻
                        </p>
                        <p className="mt-1 text-[12.5px] text-[#6b7280]">
                          {data.emptyHint ?? '建议调整时间窗或更换更宽泛的关键词。'}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            onClick={() => {
                              setTimeStart(halfYearAgo);
                              setTimeEnd(today);
                            }}
                            className="rounded border border-[#e5e7eb] px-2.5 py-1 text-[11.5px] text-[#4b5563] transition-colors hover:border-[#d93025] hover:text-[#d93025]"
                          >
                            重置为最近半年
                          </button>
                          {['收购', '增持', '减持', '年度报告'].map((kw) => (
                            <button
                              key={kw}
                              onClick={() => setQuery(kw)}
                              className="rounded border border-[#e5e7eb] px-2.5 py-1 text-[11.5px] text-[#4b5563] transition-colors hover:border-[#d93025] hover:text-[#d93025]"
                            >
                              试用关键词：{kw}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              data.items.map((item) => {
                const open = Boolean(expanded[item.externalId]);
                const badge = item.origin ? ORIGIN_LABEL[item.origin] : null;
                return (
                  <article key={item.externalId} className="paper-card overflow-hidden p-3.5">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 w-1 self-stretch rounded bg-[#c12a26]" />
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-2">
                          <span className="rounded bg-[#fdecec] px-1.5 py-0.5 text-[10.5px] font-medium text-[#c12a26]">
                            {SOURCE_TYPE_LABELS[item.sourceType]}
                          </span>
                          {item.meta?.bulletinType && (
                            <span className="text-[11px] text-[#6b7280]">{item.meta.bulletinType}</span>
                          )}
                          {badge && (
                            <span className={`rounded-full border px-1.5 py-px text-[10px] ${badge.cls}`}>{badge.text}</span>
                          )}
                          <span className="text-[11px] text-[#6b7280]">{item.sourceName}</span>
                        </div>
                        <h4 className="text-[13.5px] font-semibold leading-snug text-[#1f2329]">{item.title}</h4>
                        <p className={`mt-1 text-[12.5px] leading-relaxed text-[#4b5563] ${open ? '' : 'line-clamp-2'}`}>
                          {item.content}
                        </p>
                        <button
                          onClick={() => setExpanded((p) => ({ ...p, [item.externalId]: !open }))}
                          className="mt-1 text-[11.5px] font-medium text-[#c12a26] hover:underline"
                        >
                          {open ? '收起出处' : '查看原文出处与四时间戳'}
                        </button>
                        {open && (
                          <div className="mt-2 rounded-md border border-[#e5e7eb] bg-[#fbfaf6] p-3">
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px]">
                              <TraceRow label="披露时间" value={fmt(item.disclosedAt)} />
                              <TraceRow label="抓取时间" value={fmt(item.fetchedAt)} />
                              <TraceRow label="外部 ID" value={item.externalId} mono />
                              {item.announcementNo && <TraceRow label="公告编号" value={item.announcementNo} mono />}
                              {item.url && (
                                <div className="col-span-2">
                                  <dt className="inline text-[#6b7280]">来源链接：</dt>
                                  <dd className="inline">
                                    <a href={item.url} target="_blank" rel="noreferrer" className="text-[#c12a26] hover:underline">
                                      {item.url}
                                    </a>
                                  </dd>
                                </div>
                              )}
                            </dl>
                            {!item.url && !item.announcementNo && (
                              <p className="mt-2 text-[11px] text-[#6b7280]">
                                iFinD 返回的是与查询强相关的片段文本（非全文），无独立 URL；标题+日期+外部 ID 共同构成可追溯标识。
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </section>
        </>
      )}

      {!loading && !data && (
        <div className="paper-card p-8 text-center text-[13px] text-[#6b7280]">
          输入标的并点击「从 iFinD 实时拉取」，将依次调用 search_notice（公告）与 search_news（财经新闻），
          自动执行缓存命中、限流（≥1s）、失败重试与降级链。
        </div>
      )}
    </div>
  );
}

function TraceRow({ label, value, mono }: { label: string; value: string; mono?: boolean }): ReactElement {
  return (
    <div>
      <dt className="inline text-[#6b7280]">{label}：</dt>
      <dd className={`inline text-[#4b5563] ${mono ? 'mono' : ''}`}>{value}</dd>
    </div>
  );
}
