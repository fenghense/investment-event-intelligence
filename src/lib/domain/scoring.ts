import type {
  Credibility,
  EventStatus,
  Evidence,
  ExtractedElements,
  SourceType,
  WeightBreakdown,
} from './types';

// ============================================================
// 证据权重评分
// 综合：来源类型基础分 + 要素完整度 + 多源印证数 + 来源历史命中率
//      + 官方确认标记 - 利益相关性罚分
// ============================================================

/** 来源类型基础分：公告/交易所披露 > 财经媒体 > 研报 > 官方社媒 > 社交媒体/论坛 > 个人传闻 */
export const SOURCE_BASE_SCORE: Record<SourceType, number> = {
  exchange: 42,
  announcement: 40,
  media: 26,
  research: 20,
  official_social: 16,
  social: 8,
  personal: 5,
};

const ELEMENT_MAX = 20;
const CORROBORATION_PER_SOURCE = 4;
const CORROBORATION_MAX = 12;
const HIT_RATE_MAX = 10;
const OFFICIAL_CONFIRM_BONUS = 10;
const INTEREST_PENALTY = -12;

export interface ScoreInput {
  sourceType: SourceType;
  extracted: ExtractedElements;
  /** 同一事件内独立来源数（不同 sourceName），含本条 */
  corroborationCount: number;
  /** 来源历史命中率 0-1 */
  sourceHitRate: number;
  officialConfirm: boolean;
  interestRelated: boolean;
}

export function scoreEvidence(input: ScoreInput): WeightBreakdown {
  const sourceBase = SOURCE_BASE_SCORE[input.sourceType];

  let elements = 0;
  if (input.extracted.subject) elements += 5;
  if (input.extracted.action !== 'OTHER') elements += 5;
  if (input.extracted.object) elements += 5;
  if (input.extracted.time) elements += 5;
  const elementCompleteness = Math.min(elements, ELEMENT_MAX);

  const corroboration = Math.min(
    Math.max(0, input.corroborationCount - 1) * CORROBORATION_PER_SOURCE,
    CORROBORATION_MAX,
  );

  const sourceHitRate = Math.round(Math.max(0, Math.min(1, input.sourceHitRate)) * HIT_RATE_MAX);
  const officialConfirm = input.officialConfirm ? OFFICIAL_CONFIRM_BONUS : 0;
  const interestPenalty = input.interestRelated ? INTEREST_PENALTY : 0;

  const total = Math.max(
    0,
    Math.min(100, sourceBase + elementCompleteness + corroboration + sourceHitRate + officialConfirm + interestPenalty),
  );

  return { sourceBase, elementCompleteness, corroboration, sourceHitRate, officialConfirm, interestPenalty, total };
}

/** 事件可信度：取权重最高的前 3 条证据加权平均；被否认状态封顶为低可信 */
export function computeEventCredibility(
  status: EventStatus,
  evidenceList: Evidence[],
): { score: number; level: Credibility } {
  if (evidenceList.length === 0) return { score: 0, level: 'low' };

  const top = [...evidenceList].sort((a, b) => b.weight.total - a.weight.total).slice(0, 3);
  const raw = Math.round(top.reduce((sum, e) => sum + e.weight.total, 0) / top.length);

  if (status === 'denied') {
    return { score: Math.min(raw, 25), level: 'low' };
  }

  const level: Credibility = raw >= 70 ? 'high' : raw >= 45 ? 'medium' : 'low';
  return { score: raw, level };
}
