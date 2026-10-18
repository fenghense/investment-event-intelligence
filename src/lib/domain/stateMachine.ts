import type { EventStatus, Evidence, SourceType } from './types';

// ============================================================
// 版本演化状态机
// 合法转换：
//   published → updated / corrected / denied / expired
//   updated   → corrected / denied / expired
//   corrected → updated / denied / expired
//   denied    → revived（高证据门槛：官方再次确认 或 ≥3 个独立高质量来源印证）
//   expired   → updated（新进展重新激活并关联原事件）
//   revived   → updated / corrected / denied / expired
// 其余转换一律阻止。
// ============================================================

export const LEGAL_TRANSITIONS: Record<EventStatus, EventStatus[]> = {
  published: ['updated', 'corrected', 'denied', 'expired'],
  updated: ['corrected', 'denied', 'expired'],
  corrected: ['updated', 'denied', 'expired'],
  denied: ['revived'],
  expired: ['updated'],
  revived: ['updated', 'corrected', 'denied', 'expired'],
};

export interface TransitionCheck {
  legal: boolean;
  blockedReason?: string;
}

export function checkTransition(from: EventStatus, to: EventStatus): TransitionCheck {
  if (from === to) {
    // 同状态不算转换：仅追加版本（如 updated 状态下继续补充证据）
    return { legal: true };
  }
  const allowed = LEGAL_TRANSITIONS[from];
  if (allowed.includes(to)) return { legal: true };
  return {
    legal: false,
    blockedReason: `非法状态转换：${from} → ${to}。${from} 仅允许转换为：${allowed.join(' / ') || '（无）'}`,
  };
}

// ------------------------------------------------------------
// 否认复活门槛
// ------------------------------------------------------------

export const REVIVAL_MIN_SOURCES = 3;
export const REVIVAL_QUALITY_WEIGHT = 55;
const HIGH_QUALITY_SOURCE_TYPES: SourceType[] = ['announcement', 'exchange', 'media'];

export interface RevivalCheck {
  passed: boolean;
  via: 'official_confirm' | 'multi_source' | null;
  detail: string;
}

/**
 * 复活门槛校验（仅 denied → revived 使用）：
 * 门槛一：官方再次确认 —— 新证据来自公告/交易所披露且带官方确认标记
 * 门槛二：≥3 个独立高质量来源印证 —— 事件内不同来源名、权重达标、
 *         且来源类型为公告/交易所/财经媒体的证据（含新证据）
 */
export function checkRevivalThreshold(newEvidence: Evidence, eventEvidence: Evidence[]): RevivalCheck {
  const officialAgain =
    (newEvidence.sourceType === 'announcement' || newEvidence.sourceType === 'exchange') &&
    newEvidence.officialConfirm;
  if (officialAgain) {
    return {
      passed: true,
      via: 'official_confirm',
      detail: `官方再次确认：${newEvidence.sourceName}发布${newEvidence.announcementNo ? `公告（${newEvidence.announcementNo}）` : '公告'}，满足反转门槛`,
    };
  }

  const all = [...eventEvidence, newEvidence];
  const qualifiedSources = new Set(
    all
      .filter(
        (e) =>
          HIGH_QUALITY_SOURCE_TYPES.includes(e.sourceType) &&
          e.weight.total >= REVIVAL_QUALITY_WEIGHT &&
          e.evidenceType !== 'rumor' &&
          // 排除“否认证据”本身：澄清公告不能作为复活印证来源
          e.extracted.action !== 'DENY',
      )
      .map((e) => e.sourceName),
  );

  if (qualifiedSources.size >= REVIVAL_MIN_SOURCES) {
    return {
      passed: true,
      via: 'multi_source',
      detail: `${qualifiedSources.size} 个独立高质量来源（${[...qualifiedSources].join('、')}）交叉印证，满足反转门槛`,
    };
  }

  return {
    passed: false,
    via: null,
    detail: `未达反转门槛：官方再次确认=否；独立高质量来源 ${qualifiedSources.size}/${REVIVAL_MIN_SOURCES}（要求来源类型为公告/交易所披露/财经媒体且权重≥${REVIVAL_QUALITY_WEIGHT}）。事件维持“已否认”状态，证据已归档备查`,
  };
}
