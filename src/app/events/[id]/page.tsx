'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type {
  AppNotification,
  EventDetailResponse,
  EventVersion,
  Evidence,
  InvestmentEvent,
  TimelineEntry,
} from '@/lib/domain/types';
import { ACTION_LABELS, NOTIFICATION_KIND_LABELS } from '@/lib/domain/vocabulary';
import type { W2Result } from '@/lib/workflows/w2Grading';
import type { W3Result } from '@/lib/workflows/w3Evolution';
import type { W4Result } from '@/lib/workflows/w4Impact';
import type { WorkflowNodeTrace } from '@/lib/workflows/types';
import type { TargetImpact } from '@/lib/adapters/fuyao/marketAdapter';
import {
  CredibilityBar,
  EvidenceTypeBadge,
  SectionTitle,
  SourceTypeBadge,
  StatusSeal,
  formatDate,
  formatDateTime,
  sourceTypeColor,
} from '@/components/app/ui-bits';
import { FavoriteButton } from '@/components/app/favorite-button';

interface EventDetail extends InvestmentEvent {
  evidence: Evidence[];
  notifications: AppNotification[];
  timeline: TimelineEntry[];
}

// 高权重来源：公告 / 交易所 / 主流新闻（默认展示）；其余为低权重（默认折叠）
const HIGH_WEIGHT_SOURCES = new Set(['announcement', 'exchange', 'media']);

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<string | null>(null);
  const [showLowWeight, setShowLowWeight] = useState(false);
  const [w2, setW2] = useState<W2Result | null>(null);
  const [w3, setW3] = useState<W3Result | null>(null);
  const [w4, setW4] = useState<W4Result | null>(null);
  const [showWorkflowNodes, setShowWorkflowNodes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const res = await fetch(`/api/events/${params.id}`, { cache: 'no-store' });
      if (res.status === 404) {
        if (!cancelled) setNotFound(true);
        return;
      }
      const data = (await res.json()) as EventDetailResponse;
      if (cancelled) return;
      setDetail({
        ...data.event,
        evidence: data.evidence,
        notifications: data.notifications,
        timeline: data.timeline,
      });

      // 并行触发工作流 W2 证据分级 / W3 版本演化 / W4 影响分析
      const run = async (workflow: 'w2' | 'w3' | 'w4'): Promise<unknown> => {
        const r = await fetch('/api/workflows/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workflow, eventId: params.id }),
        });
        if (!r.ok) return null;
        return r.json();
      };
      const [r2, r3, r4] = await Promise.allSettled([run('w2'), run('w3'), run('w4')]);
      if (cancelled) return;
      if (r2.status === 'fulfilled' && r2.value) setW2(r2.value as W2Result);
      if (r3.status === 'fulfilled' && r3.value) setW3(r3.value as W3Result);
      if (r4.status === 'fulfilled' && r4.value) setW4(r4.value as W4Result);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  const visibleEvidence = useMemo(() => {
    if (!detail) return [];
    if (selectedVersion === null) return detail.evidence;
    const version = detail.versions.find((v) => v.version === selectedVersion);
    if (!version) return detail.evidence;
    return detail.evidence.filter((e) => version.evidenceSnapshot.includes(e.id));
  }, [detail, selectedVersion]);

  const { highEvidence, lowEvidence } = useMemo(() => {
    const high: Evidence[] = [];
    const low: Evidence[] = [];
    for (const e of visibleEvidence) {
      (HIGH_WEIGHT_SOURCES.has(e.sourceType) ? high : low).push(e);
    }
    return { highEvidence: high, lowEvidence: low };
  }, [visibleEvidence]);

  if (notFound) {
    return (
      <div className="py-24 text-center">
        <p className="text-[#6b7280]">事件不存在或已被移除</p>
        <Link href="/events" className="mt-3 inline-block text-sm text-[#d93025] hover:underline">
          返回事件监控
        </Link>
      </div>
    );
  }
  if (!detail) return <DetailSkeleton />;

  const deniedVersion = detail.versions.find((v) => v.status === 'denied');
  const credibilityText = w2?.credibilityText ?? `${detail.credibility === 'high' ? '高' : detail.credibility === 'medium' ? '中' : '低'}（评分 ${detail.credibilityScore}/100）`;
  const workflowNodes: Array<{ wf: string; trace: WorkflowNodeTrace }> = [
    ...(w2?.nodes.map((trace) => ({ wf: 'W2 证据分级', trace })) ?? []),
    ...(w3?.nodes.map((trace) => ({ wf: 'W3 版本演化', trace })) ?? []),
    ...(w4?.nodes.map((trace) => ({ wf: 'W4 影响分析', trace })) ?? []),
  ];

  return (
    <div>
      <Link href="/events" className="mono text-xs text-[#6b7280] hover:text-[#d93025]">
        ← 返回事件监控
      </Link>

      {/* 吸顶状态摘要卡：3 秒结论 */}
      <div className="sticky top-14 z-20 -mx-4 bg-[#f5f6fa]/95 px-4 pb-3 pt-3 backdrop-blur-sm">
        <div className="paper-card border-l-4 p-4" style={{ borderLeftColor: statusColor(detail.status) }}>
          <div className="flex flex-wrap items-center gap-3">
            <StatusSeal status={detail.status} />
            <h1 className="text-[19px] font-bold tracking-tight text-[#1f2329]">{detail.title}</h1>
            {detail.hasDenialRecord && (
              <span className="seal seal-hollow" style={{ color: '#991b1b', borderColor: '#991b1b' }}>
                曾有否认记录{deniedVersion ? `（${formatDate(deniedVersion.changedAt)} 被否认）` : ''}
              </span>
            )}
            <span className="ml-auto">
              <FavoriteButton eventId={detail.id} favorited={detail.favorited ?? false} />
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1">
            <span className="text-[13px] font-semibold text-[#1f2329]">
              综合置信度：<b className="text-[#d93025]">{credibilityText}</b>
            </span>
            <CredibilityBar score={detail.credibilityScore} level={detail.credibility} />
            <span className="mono text-[11.5px] text-[#6b7280]">最近更新 {formatDateTime(detail.updatedAt)}</span>
          </div>
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[#6b7280]">{detail.summary}</p>
        </div>
      </div>

      {/* 要素卡片 */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ElementCard label="主体 SUBJECT" value={detail.subject} sub={detail.subjectCode ?? '未上市/无代码'} />
        <ElementCard label="动作 ACTION" value={ACTION_LABELS[detail.action]} sub={detail.action} accent />
        <ElementCard label="对象 OBJECT" value={detail.object} sub={detail.objectCode ?? '—'} />
        <ElementCard
          label="事件时间 TIME"
          value={detail.eventTime ?? '未披露'}
          sub={detail.eventTime ? '抽取自文本，非结构化字段' : '—'}
        />
      </div>
      <div className="mono mt-2 text-[11px] text-[#9ca3af]">dedup_key = {detail.dedupKey}</div>

      {/* W4 影响分析 */}
      <div className="mt-6">
        <SectionTitle
          right={
            w4 && (
              <span className="mono text-[11px] text-[#6b7280]">
                行情源：{w4.marketOrigin === 'fuyao' ? '扶摇实时' : w4.marketOrigin === 'ifind' ? 'iFinD 实时行情' : '演示降级行情'}
              </span>
            )
          }
        >
          标的关联与影响分析 · W4
        </SectionTitle>
        {!w4 ? (
          <div className="grid animate-pulse grid-cols-1 gap-3 md:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="paper-card p-4">
                <div className="h-4 w-40 rounded bg-[#eceef3]" />
                <div className="mt-3 h-14 rounded bg-[#eceef3]" />
              </div>
            ))}
          </div>
        ) : w4.impacts.length === 0 ? (
          <p className="text-xs text-[#6b7280]">该事件未关联到登记标的，暂无行情影响验证</p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {w4.impacts.map((impact) => (
                <ImpactCard key={impact.code} impact={impact} />
              ))}
            </div>
            <div className="mt-3 rounded-md border border-[#e5e7eb] bg-white px-4 py-3 text-[13px] leading-relaxed text-[#4b5563]">
              <span className="mr-2 rounded bg-[#d93025]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#d93025]">
                影响摘要
              </span>
              {w4.summary}
            </div>
          </>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-5">
        {/* 时间线（版本历史 + 状态变更 + 证据链） */}
        <section className="xl:col-span-3">
          <SectionTitle
            right={<span className="mono text-[11px] text-[#6b7280]">{detail.timeline.length} 个节点</span>}
          >
            事件时间线 · 版本演化
          </SectionTitle>
          <div className="timeline-rail space-y-5">
            {detail.timeline.map((entry, i) => (
              <TimelineNode key={`${entry.at}-${i}`} entry={entry} />
            ))}
          </div>

          {/* 版本链：逐版本回看 */}
          <div className="mt-6">
            <SectionTitle
              right={
                selectedVersion !== null && (
                  <button
                    onClick={() => setSelectedVersion(null)}
                    className="text-xs text-[#d93025] hover:underline"
                  >
                    回到当前版本
                  </button>
                )
              }
            >
              版本链 · 逐版本回看
            </SectionTitle>
            <div className="flex flex-wrap gap-2">
              {detail.versions.map((v) => (
                <button
                  key={v.version}
                  onClick={() => setSelectedVersion(v.version)}
                  className={`rounded-md border px-2.5 py-1.5 text-left transition-all ${
                    selectedVersion === v.version
                      ? 'border-[#d93025] bg-[#d93025]/5'
                      : 'border-[#e5e7eb] bg-white hover:border-[#9ca3af]'
                  }`}
                >
                  <span className="mono text-[11px] font-semibold text-[#d93025]">v{v.version}</span>
                  <span className="ml-1.5 text-[11px] text-[#6b7280]">{formatDate(v.changedAt)}</span>
                  <div className="mt-0.5">
                    <StatusSeal status={v.status} size="sm" />
                  </div>
                </button>
              ))}
            </div>
            {selectedVersion !== null && (
              <p className="mt-2 rounded bg-[#fef3c7] px-3 py-1.5 text-xs text-[#92400e]">
                正在回看第 {selectedVersion} 版本快照：下方证据列表仅显示该版本时点已收录的{' '}
                {visibleEvidence.length} 条证据。
              </p>
            )}
          </div>

          {/* 通知历史 */}
          <div className="mt-6">
            <SectionTitle>通知历史</SectionTitle>
            {detail.notifications.length === 0 ? (
              <p className="text-xs text-[#6b7280]">该事件尚无状态变更通知</p>
            ) : (
              <div className="space-y-2">
                {detail.notifications.map((n) => (
                  <div key={n.id} className="paper-card p-3">
                    <div className="flex items-center gap-2">
                      <NotificationKindBadge kind={n.kind} />
                      <span className="text-[13px] font-medium">{n.title}</span>
                      <span className="mono ml-auto text-[11px] text-[#6b7280]">
                        {formatDateTime(n.createdAt)}
                      </span>
                    </div>
                    {n.diffNote && (
                      <div className={`diff-note mt-2 ${n.kind === 'fact_update' ? 'diff-note-neutral' : ''}`}>
                        {n.diffNote}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* 证据列表：高权重默认展示，低权重默认折叠 */}
        <section className="xl:col-span-2">
          <SectionTitle
            right={
              <span className="mono text-[11px] text-[#6b7280]">
                {visibleEvidence.length} 条证据{selectedVersion !== null ? `（v${selectedVersion} 快照）` : ''}
              </span>
            }
          >
            证据链 · 可追溯
          </SectionTitle>
          <div className="space-y-3">
            {highEvidence.map((e) => (
              <EvidenceCard
                key={e.id}
                evidence={e}
                expanded={expandedEvidence === e.id}
                onToggle={() => setExpandedEvidence(expandedEvidence === e.id ? null : e.id)}
              />
            ))}
            {highEvidence.length === 0 && (
              <p className="text-xs text-[#6b7280]">无公告 / 主流新闻级证据</p>
            )}
          </div>

          {lowEvidence.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowLowWeight(!showLowWeight)}
                className="w-full rounded-md border border-dashed border-[#d1d5db] bg-white px-3 py-2 text-[12px] text-[#6b7280] transition-colors hover:border-[#d93025] hover:text-[#d93025]"
              >
                {showLowWeight
                  ? '▲ 收起低权重证据'
                  : `▼ 展开低权重证据（${lowEvidence.length} 条：传闻 / 社媒 / 研报观点等）`}
              </button>
              {showLowWeight && (
                <div className="mt-3 space-y-3">
                  {lowEvidence.map((e) => (
                    <EvidenceCard
                      key={e.id}
                      evidence={e}
                      muted
                      expanded={expandedEvidence === e.id}
                      onToggle={() => setExpandedEvidence(expandedEvidence === e.id ? null : e.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* 工作流节点轨迹（默认折叠） */}
      <div className="mt-8">
        <button
          onClick={() => setShowWorkflowNodes((v) => !v)}
          className="flex w-full items-center gap-2 rounded-md border border-[#e5e7eb] bg-white px-4 py-2.5 text-left transition-colors hover:border-[#9ca3af]"
        >
          <span className="text-[13px] font-semibold text-[#1f2329]">Agent 工作流节点轨迹</span>
          <span className="mono rounded bg-[#f5f6fa] px-1.5 py-0.5 text-[10.5px] text-[#6b7280]">
            {workflowNodes.length > 0 ? `${workflowNodes.length} 个节点` : '加载中'}
          </span>
          <span className="ml-auto text-[12px] text-[#6b7280]">
            {showWorkflowNodes ? '收起 ▴' : '展开 ▾'}
          </span>
        </button>
        {showWorkflowNodes && (
          <div className="mt-3">
            {w3 && <p className="mb-3 text-[12px] text-[#6b7280]">{w3.narrative}</p>}
            {workflowNodes.length === 0 ? (
              <div className="grid animate-pulse grid-cols-1 gap-2 md:grid-cols-3">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-16 rounded-md bg-[#eceef3]" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                {workflowNodes.map(({ wf, trace }, i) => (
                  <div key={`${wf}-${i}`} className="paper-card p-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-[#d93025]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#d93025]">
                        {wf}
                      </span>
                      <span className="text-[12.5px] font-semibold text-[#1f2329]">{trace.node}</span>
                      <span className="mono ml-auto text-[10.5px] text-[#9ca3af]">
                        {trace.engine} · {trace.durationMs}ms
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-relaxed text-[#6b7280]">{trace.detail}</p>
                    {trace.items !== undefined && (
                      <div className="mono mt-1 text-[10.5px] text-[#9ca3af]">处理 {trace.items} 项</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function statusColor(status: InvestmentEvent['status']): string {
  switch (status) {
    case 'denied':
      return '#991b1b';
    case 'corrected':
      return '#d97706';
    case 'expired':
      return '#6b7280';
    case 'revived':
      return '#ea580c';
    default:
      return '#0da678';
  }
}

function ImpactCard({ impact }: { impact: TargetImpact }) {
  const up = (impact.eventDayPct ?? impact.windowPct ?? 0) >= 0;
  return (
    <div className="paper-card p-4">
      <div className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-[#1f2329]">{impact.name}</span>
        <span className="mono text-[11px] text-[#9ca3af]">{impact.code}</span>
        {impact.anomaly && (
          <span className="rounded bg-[#d93025]/10 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#d93025]">
            量价异动
          </span>
        )}
        {impact.eventDate && (
          <span className="mono ml-auto text-[10.5px] text-[#9ca3af]">事件日 {impact.eventDate}</span>
        )}
      </div>
      {impact.kline.length > 0 && (
        <MiniKline kline={impact.kline} eventDate={impact.eventDate} up={up} />
      )}
      <div className="mt-2 grid grid-cols-4 gap-2 text-center">
        <Metric label="事件日涨跌" value={impact.eventDayPct !== null ? `${impact.eventDayPct > 0 ? '+' : ''}${impact.eventDayPct}%` : '—'} highlight />
        <Metric label="次日涨跌" value={impact.nextDayPct !== null ? `${impact.nextDayPct > 0 ? '+' : ''}${impact.nextDayPct}%` : '—'} />
        <Metric label="量比" value={impact.volumeRatio !== null ? `${impact.volumeRatio}x` : '—'} />
        <Metric label="±5日区间" value={impact.windowPct !== null ? `${impact.windowPct > 0 ? '+' : ''}${impact.windowPct}%` : '—'} />
      </div>
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  const negative = value.startsWith('-');
  const positive = value.startsWith('+');
  return (
    <div className="rounded bg-[#f5f6fa] px-1 py-1.5">
      <div className="text-[10px] text-[#9ca3af]">{label}</div>
      <div
        className={`mono text-[13px] font-semibold ${
          positive ? 'text-[#d93025]' : negative ? 'text-[#0da678]' : highlight ? 'text-[#1f2329]' : 'text-[#1f2329]'
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// 迷你行情图：A 股规范红涨绿跌，事件日竖线标记
function MiniKline({
  kline,
  eventDate,
  up,
}: {
  kline: Array<{ date: string; close: number }>;
  eventDate: string | null;
  up: boolean;
}) {
  const W = 320;
  const H = 56;
  const closes = kline.map((k) => k.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const pts = kline
    .map((k, i) => `${((i / Math.max(kline.length - 1, 1)) * W).toFixed(1)},${(H - 4 - ((k.close - min) / span) * (H - 8)).toFixed(1)}`)
    .join(' ');
  const eventIdx = eventDate ? kline.findIndex((k) => k.date >= eventDate) : -1;
  const ex = eventIdx >= 0 ? (eventIdx / Math.max(kline.length - 1, 1)) * W : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 h-14 w-full" preserveAspectRatio="none">
      <polyline points={pts} fill="none" stroke={up ? '#d93025' : '#0da678'} strokeWidth="1.5" />
      {ex !== null && (
        <line x1={ex} y1={0} x2={ex} y2={H} stroke="#d97706" strokeWidth="1" strokeDasharray="3 2" />
      )}
    </svg>
  );
}

function ElementCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="paper-card p-3">
      <div className="mono text-[9.5px] uppercase tracking-[0.14em] text-[#6b7280]">{label}</div>
      <div className={`mt-1 text-[15px] font-semibold ${accent ? 'text-[#d93025]' : 'text-[#1f2329]'}`}>
        {value}
      </div>
      <div className="mono mt-0.5 text-[10.5px] text-[#9ca3af]">{sub}</div>
    </div>
  );
}

// 时间线节点：统一卡片结构 —— 头部（类型色点 + 类型名 + 徽标组 + 右侧时间戳）与正文分区
function TimelineNode({ entry }: { entry: TimelineEntry }) {
  if (entry.kind === 'created') {
    return (
      <TimelineShell color="#0da678" kindLabel="事件建立" at={entry.at} badges={<StatusSeal status="published" size="sm" />}>
        <p className="text-xs leading-relaxed text-[#6b7280]">{entry.detail}</p>
      </TimelineShell>
    );
  }
  if (entry.kind === 'evidence' && entry.evidence) {
    const e = entry.evidence;
    return (
      <TimelineShell
        color={sourceTypeColor(e.sourceType)}
        kindLabel="收录证据"
        at={entry.at}
        badges={
          <>
            <SourceTypeBadge type={e.sourceType} />
            <EvidenceTypeBadge type={e.evidenceType} />
            <span className="mono text-[10.5px] text-[#9ca3af]">权重 {e.weight.total} · v{e.version}</span>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-[#6b7280]">
          {e.sourceName}《{e.title}》
        </p>
      </TimelineShell>
    );
  }
  if (entry.kind === 'status' && entry.version) {
    const v: EventVersion = entry.version;
    const isRevocation = v.status === 'denied' || v.status === 'corrected' || v.status === 'revived';
    return (
      <TimelineShell
        color={statusColor(v.status)}
        kindLabel="状态变更"
        at={entry.at}
        badges={
          <>
            <StatusSeal status={v.status} size="sm" />
            <span className="mono text-[10.5px] text-[#9ca3af]">
              {entry.fromStatus} → {entry.toStatus} · v{v.version}
            </span>
          </>
        }
      >
        <p className="text-xs leading-relaxed text-[#6b7280]">{v.reason}</p>
        {v.diffNote && (
          <div className={`diff-note mt-2 ${isRevocation ? '' : 'diff-note-neutral'}`}>{v.diffNote}</div>
        )}
      </TimelineShell>
    );
  }
  return null;
}

function TimelineShell({
  color,
  kindLabel,
  at,
  badges,
  children,
}: {
  color: string;
  kindLabel: string;
  at: string;
  badges?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <span className="timeline-dot" style={{ borderColor: color }} />
      <div className="paper-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#f0f1f4] px-3.5 py-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[12.5px] font-semibold text-[#1f2329]">{kindLabel}</span>
          <span className="flex flex-wrap items-center gap-1.5">{badges}</span>
          <span className="mono ml-auto text-[10.5px] text-[#9ca3af]">{formatDateTime(at)}</span>
        </div>
        <div className="px-3.5 py-2.5">{children}</div>
      </div>
    </div>
  );
}

function NotificationKindBadge({ kind }: { kind: AppNotification['kind'] }) {
  const style =
    kind === 'fact_revocation'
      ? { fg: '#991b1b', bg: '#fdedec' }
      : kind === 'fact_update'
        ? { fg: '#d93025', bg: '#fdedec' }
        : { fg: '#6b7280', bg: '#f3f4f6' };
  return (
    <span
      className="rounded px-1.5 py-0.5 text-[11px] font-semibold"
      style={{ color: style.fg, backgroundColor: style.bg }}
    >
      {NOTIFICATION_KIND_LABELS[kind]}
    </span>
  );
}

function EvidenceCard({
  evidence: e,
  expanded,
  onToggle,
  muted,
}: {
  evidence: Evidence;
  expanded: boolean;
  onToggle: () => void;
  muted?: boolean;
}) {
  const w = e.weight;
  return (
    <article
      className={`evidence-rail overflow-hidden rounded-md border ${
        muted ? 'border-[#e5e7eb]/50 bg-[#fafafa]' : 'paper-card'
      }`}
      style={{ borderLeftColor: sourceTypeColor(e.sourceType) }}
    >
      <button onClick={onToggle} className={`block w-full text-left ${muted ? 'p-2.5' : 'p-3'}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceTypeBadge type={e.sourceType} />
          <EvidenceTypeBadge type={e.evidenceType} />
          {e.officialConfirm && (
            <span className="rounded bg-[#d93025]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#d93025]">
              官方确认
            </span>
          )}
          {e.interestRelated && (
            <span className="rounded bg-[#fdedec] px-1.5 py-0.5 text-[11px] font-semibold text-[#991b1b]">
              利益相关·已罚分
            </span>
          )}
          <span className="mono ml-auto text-[11px] text-[#6b7280]">权重 {w.total}/100</span>
        </div>
        <div
          className={`mt-1.5 font-medium leading-snug text-[#1f2329] ${
            muted ? 'text-[12.5px]' : 'text-[13.5px]'
          }`}
        >
          {e.title}
        </div>
        <div className={`mt-0.5 text-[#6b7280] ${muted ? 'text-[11px]' : 'text-xs'}`}>{e.sourceName}</div>
        <p
          className={`mt-1.5 leading-relaxed text-[#6b7280] ${muted ? 'text-[11.5px]' : 'text-xs'} ${
            expanded ? '' : 'line-clamp-2'
          }`}
        >
          {e.content}
        </p>
        <div className="mono mt-2 text-[10px] uppercase tracking-wider text-[#9ca3af]">
          {expanded ? '▲ 收起出处与评分明细' : '▼ 展开出处与评分明细'}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#f3f4f6] bg-white px-3 py-3">
          {/* 权重评分明细 */}
          <div className="mono text-[9.5px] uppercase tracking-[0.14em] text-[#6b7280]">
            权重评分明细 Weight Breakdown
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px]">
            <ScoreRow label="来源基础分" value={w.sourceBase} />
            <ScoreRow label="要素完整度" value={w.elementCompleteness} />
            <ScoreRow label={`多源印证 ×${e.corroborationCount}`} value={w.corroboration} />
            <ScoreRow label={`历史命中率 ${(e.sourceHitRate * 100).toFixed(0)}%`} value={w.sourceHitRate} />
            <ScoreRow label="官方确认" value={w.officialConfirm} />
            <ScoreRow label="利益相关罚分" value={w.interestPenalty} negative />
          </div>

          {/* 四时间戳 */}
          <div className="mono mt-3 text-[9.5px] uppercase tracking-[0.14em] text-[#6b7280]">
            四时间戳 Four Timestamps
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px]">
            <TimestampRow label="披露时间" value={formatDateTime(e.disclosedAt)} />
            <TimestampRow label="抓取时间" value={formatDateTime(e.fetchedAt)} />
            <TimestampRow
              label="事件发生时间"
              value={e.eventOccurredAt ? formatDate(e.eventOccurredAt) : '未提及'}
              note="抽取自文本，非结构化字段"
            />
            <TimestampRow label="更新时间" value={formatDateTime(e.updatedAt)} />
          </div>

          {/* 追溯出处 */}
          <div className="mono mt-3 text-[9.5px] uppercase tracking-[0.14em] text-[#6b7280]">
            可追溯出处 Traceability
          </div>
          <div className="mt-1.5 space-y-1 text-[11.5px] text-[#4b5563]">
            <div>
              来源：<b>{e.sourceName}</b>（external_id: <span className="mono">{e.externalId}</span>）
            </div>
            {e.announcementNo && (
              <div>
                公告编号：<span className="mono font-semibold text-[#d93025]">{e.announcementNo}</span>
              </div>
            )}
            {e.url && (
              <div className="break-all">
                原文链接：
                <a href={e.url} target="_blank" rel="noreferrer" className="mono text-[#d93025] hover:underline">
                  {e.url}
                </a>
              </div>
            )}
            <div className="mono text-[10.5px] text-[#6b7280]">raw: {JSON.stringify(e.rawFields)}</div>
          </div>
        </div>
      )}
    </article>
  );
}

function ScoreRow({ label, value, negative }: { label: string; value: number; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#6b7280]">{label}</span>
      <span className={`mono font-semibold ${negative ? 'text-[#991b1b]' : 'text-[#1f2329]'}`}>
        {value > 0 ? `+${value}` : value}
      </span>
    </div>
  );
}

function TimestampRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <div className="text-[#6b7280]">{label}</div>
      <div className="mono font-medium text-[#1f2329]">{value}</div>
      {note && <div className="text-[10px] text-[#d97706]">{note}</div>}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-3 w-24 rounded bg-[#eceef3]" />
      <div className="paper-card mt-3 border-l-4 border-l-[#eceef3] p-4">
        <div className="flex items-center gap-3">
          <div className="h-6 w-20 rounded-full bg-[#eceef3]" />
          <div className="h-6 w-2/3 rounded bg-[#eceef3]" />
        </div>
        <div className="mt-3 h-4 w-1/2 rounded bg-[#eceef3]" />
        <div className="mt-2 h-4 w-full rounded bg-[#eceef3]" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="paper-card h-20 p-3">
            <div className="h-3 w-16 rounded bg-[#eceef3]" />
            <div className="mt-2 h-5 w-3/4 rounded bg-[#eceef3]" />
          </div>
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="paper-card h-40 p-4">
            <div className="h-4 w-32 rounded bg-[#eceef3]" />
            <div className="mt-3 h-14 rounded bg-[#eceef3]" />
          </div>
        ))}
      </div>
    </div>
  );
}
