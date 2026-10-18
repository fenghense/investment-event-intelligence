import { getStore } from '@/lib/server/store';
import { scoreEvidence } from '@/lib/domain/scoring';
import { SOURCE_TYPE_LABELS, EVIDENCE_TYPE_LABELS } from '@/lib/domain/vocabulary';
import type { Evidence, SourceType } from '@/lib/domain/types';
import { timed, type WorkflowNodeTrace, type WorkflowWarning } from './types';

// ============================================================
// 工作流 2：证据分级与时间线构建（Evidence Grading & Timeline）
// 来源可信度分级：公告/交易所 > 研报 > 权威媒体 > 官方社媒 > 社媒 > 个人传闻
// 事实类型标注：事实陈述 / 观点判断 / 推测 / 传闻
// 时间线：事件发生 / 披露 / 抓取 / 更新 四时间戳
// 输出：带时间戳的证据链
// ============================================================

export type SourceTier = 'T1' | 'T2' | 'T3' | 'T4';

export const SOURCE_TIER: Record<SourceType, SourceTier> = {
  announcement: 'T1',
  exchange: 'T1',
  research: 'T2',
  media: 'T3',
  official_social: 'T3',
  social: 'T4',
  personal: 'T4',
};

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  T1: '公告级',
  T2: '研报级',
  T3: '媒体级',
  T4: '社媒级',
};

export interface GradedEvidence {
  evidence: Evidence;
  tier: SourceTier;
  tierLabel: string;
  factTypeLabel: string;
  weight: number;
  timestamps: {
    eventOccurredAt: string | null;
    disclosedAt: string;
    fetchedAt: string;
    updatedAt: string;
  };
}

export interface TimelineChainItem {
  at: string;
  kind: 'occurred' | 'disclosed';
  evidenceId: string;
  title: string;
  tier: SourceTier;
}

export interface W2Result {
  nodes: WorkflowNodeTrace[];
  warnings: WorkflowWarning[];
  eventId: string;
  eventTitle: string;
  evidenceChain: GradedEvidence[];
  timeline: TimelineChainItem[];
  tierSummary: Record<SourceTier, number>;
  highWeightCount: number;
  announcementLevelCount: number;
  credibilityText: string;
}

export async function runW2EvidenceGrading(eventId: string): Promise<W2Result | null> {
  const store = await getStore();
  const event = store.getEvent(eventId);
  if (!event) return null;
  const nodes: WorkflowNodeTrace[] = [];
  const warnings: WorkflowWarning[] = [];
  const evidenceList = store.evidenceOf(eventId);

  // ---- 节点 1：来源可信度分级 ----
  const gradeRun = timed(() =>
    evidenceList.map((ev) => {
      const tier = SOURCE_TIER[ev.sourceType];
      return { ev, tier };
    }),
  );
  const tierSummary: Record<SourceTier, number> = { T1: 0, T2: 0, T3: 0, T4: 0 };
  gradeRun.value.forEach(({ tier }) => {
    tierSummary[tier] += 1;
  });
  nodes.push({
    node: '来源可信度分级',
    engine: 'rules',
    durationMs: gradeRun.ms,
    items: gradeRun.value.length,
    detail: `公告级 ${tierSummary.T1} / 研报级 ${tierSummary.T2} / 媒体级 ${tierSummary.T3} / 社媒级 ${tierSummary.T4}（公告 > 研报 > 权威媒体 > 社媒传闻）`,
  });

  // ---- 节点 2：事实类型标注 + 权重评分（六要素模型复算，保证口径一致） ----
  const scoreRun = timed(() =>
    gradeRun.value.map(({ ev, tier }) => {
      const sourceNames = new Set(evidenceList.map((e) => e.sourceName));
      const weight = scoreEvidence({
        sourceType: ev.sourceType,
        extracted: ev.extracted,
        corroborationCount: sourceNames.size,
        sourceHitRate: ev.sourceHitRate,
        officialConfirm: ev.officialConfirm,
        interestRelated: ev.interestRelated,
      });
      return {
        evidence: ev,
        tier,
        tierLabel: SOURCE_TIER_LABELS[tier],
        factTypeLabel: EVIDENCE_TYPE_LABELS[ev.evidenceType],
        weight: weight.total,
        timestamps: {
          eventOccurredAt: ev.eventOccurredAt,
          disclosedAt: ev.disclosedAt,
          fetchedAt: ev.fetchedAt,
          updatedAt: ev.updatedAt,
        },
      } satisfies GradedEvidence;
    }),
  );
  const typeCounts = scoreRun.value.reduce<Record<string, number>>((acc, g) => {
    acc[g.factTypeLabel] = (acc[g.factTypeLabel] ?? 0) + 1;
    return acc;
  }, {});
  nodes.push({
    node: '事实类型标注',
    engine: 'rules',
    durationMs: scoreRun.ms,
    items: scoreRun.value.length,
    detail: Object.entries(typeCounts).map(([k, v]) => `${k}×${v}`).join(' / ') +
      '；权重=来源基础分+要素完整度+多源印证+历史命中+官方确认-利益相关罚分',
  });

  // ---- 节点 3：时间线构建（发生/披露/抓取/更新四时间戳） ----
  const timelineRun = timed(() => {
    const chain: TimelineChainItem[] = [];
    for (const g of scoreRun.value) {
      if (g.evidence.eventOccurredAt) {
        chain.push({
          at: g.evidence.eventOccurredAt,
          kind: 'occurred',
          evidenceId: g.evidence.id,
          title: g.evidence.title,
          tier: g.tier,
        });
      }
      chain.push({
        at: g.evidence.disclosedAt,
        kind: 'disclosed',
        evidenceId: g.evidence.id,
        title: g.evidence.title,
        tier: g.tier,
      });
    }
    return chain.sort((a, b) => a.at.localeCompare(b.at));
  });
  nodes.push({
    node: '时间线构建',
    engine: 'system',
    durationMs: timelineRun.ms,
    items: timelineRun.value.length,
    detail: `${scoreRun.value.filter((g) => g.evidence.eventOccurredAt).length} 条含事件发生时间（标注"抽取自文本"），全部证据含披露/抓取/更新时间戳`,
  });

  const announcementLevelCount = tierSummary.T1;
  const highWeightCount = scoreRun.value.filter((g) => g.weight >= 55).length;
  const credibilityText = `${event.credibility === 'high' ? '高' : event.credibility === 'medium' ? '中' : '低'}（${announcementLevelCount} 条公告级证据支撑，${highWeightCount} 条高权重证据）`;

  return {
    nodes,
    warnings,
    eventId,
    eventTitle: event.title,
    evidenceChain: scoreRun.value.sort((a, b) => b.weight - a.weight),
    timeline: timelineRun.value,
    tierSummary,
    highWeightCount,
    announcementLevelCount,
    credibilityText,
  };
}
