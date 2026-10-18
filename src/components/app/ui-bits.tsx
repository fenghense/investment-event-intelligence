import type { Credibility, EventStatus, EvidenceType, SourceType } from '@/lib/domain/types';
import {
  CREDIBILITY_LABELS,
  EVIDENCE_TYPE_LABELS,
  SOURCE_TYPE_LABELS,
  STATUS_COLORS,
  STATUS_GROUP_LABELS,
  STATUS_LABELS,
} from '@/lib/domain/vocabulary';

// ============================================================
// 共享 UI 小组件（印章徽章 / 可信度 / 页面标题）
// ============================================================

export function StatusSeal({ status, size = 'md' }: { status: EventStatus; size?: 'sm' | 'md' }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      className="seal"
      style={{
        color: c.fg,
        backgroundColor: c.bg,
        borderColor: c.ring,
        fontSize: size === 'sm' ? 11 : 12,
      }}
    >
      {STATUS_LABELS[status]}
      <span className="seal-en">{status}</span>
    </span>
  );
}

export function StatusGroupChip({ status, active }: { status: EventStatus; active?: boolean }) {
  const c = STATUS_COLORS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all"
      style={{
        color: active ? '#fff' : c.fg,
        backgroundColor: active ? c.fg : c.bg,
        borderColor: c.ring,
      }}
    >
      {STATUS_GROUP_LABELS[status]}
    </span>
  );
}

const EVIDENCE_TYPE_STYLE: Record<EvidenceType, { fg: string; bg: string; bd: string; hollow?: boolean }> = {
  fact: { fg: '#d93025', bg: '#fdedec', bd: '#f5c0bc' },
  opinion: { fg: '#7C3AED', bg: '#f3effc', bd: '#ddd0f2' },
  speculation: { fg: '#d97706', bg: '#fef3c7', bd: '#e8d9ac' },
  rumor: { fg: '#991b1b', bg: 'transparent', bd: '#991b1b', hollow: true },
};

export function EvidenceTypeBadge({ type }: { type: EvidenceType }) {
  const s = EVIDENCE_TYPE_STYLE[type];
  return (
    <span
      className={`seal ${s.hollow ? 'seal-hollow' : ''}`}
      style={{ color: s.fg, backgroundColor: s.bg, borderColor: s.bd }}
    >
      {EVIDENCE_TYPE_LABELS[type]}
    </span>
  );
}

const SOURCE_TYPE_COLOR: Record<SourceType, string> = {
  exchange: '#1f5c46',
  announcement: '#0da678',
  media: '#d93025',
  research: '#7C3AED',
  official_social: '#0f6e7d',
  social: '#d97706',
  personal: '#991b1b',
};

export function SourceTypeBadge({ type }: { type: SourceType }) {
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ color: SOURCE_TYPE_COLOR[type], backgroundColor: `${SOURCE_TYPE_COLOR[type]}14` }}
    >
      {SOURCE_TYPE_LABELS[type]}
    </span>
  );
}

export function sourceTypeColor(type: SourceType): string {
  return SOURCE_TYPE_COLOR[type];
}

export function CredibilityBar({
  score,
  level,
  compact,
}: {
  score: number;
  level: Credibility;
  compact?: boolean;
}) {
  const color = level === 'low' ? '#991b1b' : level === 'medium' ? '#d97706' : '#d93025';
  return (
    <div className="flex items-center gap-2">
      <div className={`relative overflow-hidden rounded-full bg-[#fdedec] ${compact ? 'h-1.5 w-16' : 'h-2 w-24'}`}>
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-all duration-300"
          style={{ width: `${Math.max(4, score)}%`, backgroundColor: color }}
        />
      </div>
      <span className="mono text-xs font-semibold" style={{ color }}>
        {score}
      </span>
      <span className="text-xs text-[#6b7280]">可信度·{CREDIBILITY_LABELS[level]}</span>
    </div>
  );
}

export function PageHeader({ title, en, extra }: { title: string; en: string; extra?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between">
      <div className="archive-title">
        <h1 className="text-[22px] font-bold leading-tight tracking-tight text-[#1f2329]">{title}</h1>
        <div className="mono mt-0.5 text-[10px] uppercase tracking-[0.2em] text-[#6b7280]">{en}</div>
      </div>
      {extra}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between border-b border-[#e5e7eb] pb-2">
      <h2 className="text-[15px] font-semibold text-[#1f2329]">{children}</h2>
      {right}
    </div>
  );
}

export function formatDateTime(iso: string): string {
  // 服务端/客户端一致：直接格式化 ISO 字符串，避免 hydration 差异
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return iso;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

export function formatDate(iso: string): string {
  return iso.slice(0, 10);
}
