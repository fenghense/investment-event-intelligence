import type { ExtractedElements, InvestmentEvent } from './types';
import { GENERIC_OBJECT_PHRASES } from './vocabulary';

// ============================================================
// 语义级去重合并：dedup_key 精确合并 + 文本相似度近似匹配
// dedup_key = 主体代码或规范化名称 + 动作类型 + 对象归一 + 时间窗口
// ============================================================

/** 名称归一化：去掉公司后缀与标点空白 */
export function normalizeName(name: string): string {
  return name
    .replace(/(股份有限公司|有限责任公司|有限公司|集团|公司)/g, '')
    .replace(/[\s《》"'“”()（）,.，。]/g, '')
    .trim();
}

/** 时间窗口：以月为粒度（yyyy-MM），同日历月内视为同一时间窗口 */
export function timeWindowOf(dateStr: string | null): string {
  if (!dateStr) return 'unknown';
  return dateStr.slice(0, 7);
}

/**
 * 动作语义组：同一交易行为的双向表述归并。
 * 典型：收购方视角“收购/受让/入主”（ACQUISITION）与转让方视角“转让/出让”（TRANSFER）
 * 描述的是同一事件，语义级去重时视为同组兼容。
 */
export function actionGroup(action: string): string {
  if (action === 'ACQUISITION' || action === 'TRANSFER') return 'CONTROL';
  return action;
}

/** 对象归一化：泛化对象（本公司股份/公司股份等）归一为 SELF；泛指短语（合作方/交易对方等）归一为 unknown，避免“本股份/合作方”类碎片 */
export function normalizeObjectName(name: string | null): string {
  if (!name) return 'unknown';
  if (GENERIC_OBJECT_PHRASES.has(name.trim()) || GENERIC_OBJECT_PHRASES.has(normalizeName(name))) {
    return 'unknown';
  }
  const stripped = name.replace(/[\d.%,，\s]/g, '');
  if (/^(本公司|公司)?(的)?(总股本)?(股份|股权|股票|定增股份|非公开发行股份)$/.test(stripped)) {
    return 'SELF';
  }
  return normalizeName(name);
}

export interface DedupKeyInput {
  subject: string | null;
  subjectCode: string | null;
  action: string;
  object: string | null;
  objectCode: string | null;
  time: string | null;
}

/** 仅真实证券代码参与 dedup_key；NAME-/ENT- 兜底建档码会造成同一对象两种 key（同事件分裂），必须回退名称归一 */
function usableCode(code: string | null | undefined): string | null {
  if (!code) return null;
  if (code.startsWith('NAME-') || code.startsWith('ENT-')) return null;
  return code;
}

export function buildDedupKey(e: DedupKeyInput): string {
  const subject = usableCode(e.subjectCode) ?? (e.subject ? normalizeName(e.subject) : 'unknown');
  const object = usableCode(e.objectCode) ?? normalizeObjectName(e.object);
  return `${subject}|${e.action}|${object}|${timeWindowOf(e.time)}`;
}

/** 二元组 Jaccard 相似度（中文按字 bigram） */
export function bigramJaccard(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const clean = s.replace(/[\s，。；：、""''《》（）()\[\]{}]/g, '');
    const set = new Set<string>();
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
    if (clean.length === 1) set.add(clean);
    return set;
  };
  const sa = grams(a);
  const sb = grams(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const g of sa) if (sb.has(g)) inter++;
  return inter / (sa.size + sb.size - inter);
}

export type MatchType = 'exact' | 'fuzzy' | 'deny_ref' | 'reactivate' | 'new';

export interface MatchResult {
  matchType: MatchType;
  event?: InvestmentEvent;
  similarity?: number;
}

const FUZZY_THRESHOLD = 0.55;

/**
 * 实体重合度打分：澄清/届满类证据指向事件的依据。
 * subject↔subject、object↔object 重合权重最高（+2），交叉重合次之（+1）。
 * 避免“澄清公告主体=金鼎控股”误伤“明州智能→金鼎控股”这类仅 object 重合的事件。
 */
function entityOverlapScore(event: InvestmentEvent, extracted: ExtractedElements): number {
  const same = (aName: string | null, aCode: string | null, bName: string | null, bCode: string | null): boolean => {
    if (!aName && !aCode) return false;
    if (aCode && bCode && aCode === bCode) return true;
    if (aName && bName) return normalizeName(aName) === normalizeName(bName);
    return false;
  };
  let score = 0;
  if (same(extracted.subject, extracted.subjectCode, event.subject, event.subjectCode)) score += 2;
  if (same(extracted.subject, extracted.subjectCode, event.object, event.objectCode)) score += 1;
  if (same(extracted.object, extracted.objectCode, event.object, event.objectCode)) score += 2;
  if (same(extracted.object, extracted.objectCode, event.subject, event.subjectCode)) score += 1;
  return score;
}

function entityOverlap(event: InvestmentEvent, extracted: ExtractedElements): boolean {
  return entityOverlapScore(event, extracted) > 0;
}

/**
 * 在既有事件中寻找匹配合并对象：
 * 1. exact：dedup_key 相同
 * 2. deny_ref：DENY 类证据 → 找主体/对象重叠的事件（澄清公告指向被否认事件）
 * 3. reactivate：主体+动作+对象相同但时间窗口不同、且已过期的事件 → 重新激活并关联原事件
 * 4. fuzzy：同动作 + 文本相似度 ≥ 阈值
 */
export function findMatchingEvent(
  events: InvestmentEvent[],
  extracted: ExtractedElements,
  dedupKey: string,
  text: string,
): MatchResult {
  const parts = dedupKey.split('|');
  const window = parts[3] ?? 'unknown';
  // exact：dedup_key 相同；或主体+对象相同、动作同语义组（收购/转让双向表述兼容），
  // 且时间窗口一致或一方未知（早期传闻常无明确发生时间）
  const exact = events.find((e) => {
    if (e.dedupKey === dedupKey) return true;
    const p = e.dedupKey.split('|');
    const sameEntities = p[0] === parts[0] && p[2] === parts[2];
    const compatibleAction = actionGroup(p[1] ?? '') === actionGroup(parts[1] ?? '');
    const compatibleWindow = p[3] === window || p[3] === 'unknown' || window === 'unknown';
    return sameEntities && compatibleAction && compatibleWindow;
  });
  if (exact) return { matchType: 'exact', event: exact };

  // 对象互补合并：主体+动作（同语义组）相同、时间窗兼容、且对象恰好一方缺失。
  // 典型跨源重复：公告「宁德时代：关于签署战略合作协议的公告」（无对象）
  // 与新闻「宁德时代与赛力斯签署长期战略合作协议」（对象=赛力斯）→ 同一事件。
  // 消歧策略：同候选唯一（本月仅此一桩）直接合并；多候选时要求已知对象名在文本中出现。
  // （双方都有具体对象时 XOR 条件天然拒绝合并，如「与赛力斯签署」≠「与宝马签署」。）
  if (parts[1] !== 'OTHER') {
    const bridgable = events.filter((e) => {
      const p = e.dedupKey.split('|');
      if (p[0] !== parts[0]) return false;
      if (actionGroup(p[1] ?? '') !== actionGroup(parts[1] ?? '')) return false;
      if (!(p[3] === window || p[3] === 'unknown' || window === 'unknown')) return false;
      const aMissing = p[2] === 'unknown';
      const bMissing = parts[2] === 'unknown';
      if (aMissing === bMissing) return false; // 恰好一方缺失
      const known = aMissing ? parts[2] ?? '' : p[2] ?? '';
      // 泛指对象（合作方/交易对方等）不构成互补证据，禁止合并
      if (known !== 'SELF' && GENERIC_OBJECT_PHRASES.has(known)) return false;
      return true;
    });
    if (bridgable.length === 1) {
      return { matchType: 'exact', event: bridgable[0] };
    }
    const disambiguated = bridgable.find((e) => {
      const p = e.dedupKey.split('|');
      const known = p[2] === 'unknown' ? parts[2] ?? '' : p[2] ?? '';
      return known !== 'SELF' && known.length >= 2 && text.includes(known);
    });
    if (disambiguated) return { matchType: 'exact', event: disambiguated };
  }

  if (extracted.action === 'DENY') {
    // 实体重合度最高者胜（避免仅 object 重合的无关事件被误否认）
    let best: InvestmentEvent | undefined;
    let bestScore = 0;
    for (const e of events) {
      if (e.action === 'DENY') continue;
      const s = entityOverlapScore(e, extracted);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (best) return { matchType: 'deny_ref', event: best };
  }

  // TERMINATE（届满/到期/终止）类证据：指向同一实体组合下尚未终结的事件（生命周期延续）
  if (extracted.action === 'TERMINATE') {
    let best: InvestmentEvent | undefined;
    let bestScore = 0;
    for (const e of events) {
      if (e.status === 'expired' || e.action === 'DENY' || e.action === 'TERMINATE') continue;
      const s = entityOverlapScore(e, extracted);
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    if (best) return { matchType: 'fuzzy', event: best, similarity: 1 };
  }

  // denied 事件的同语义组新证据：候选复活对象，交由状态机做复活门槛校验
  const deniedRef = events.find(
    (e) =>
      e.status === 'denied' &&
      actionGroup(e.action) === actionGroup(extracted.action) &&
      entityOverlap(e, extracted),
  );
  if (deniedRef) return { matchType: 'fuzzy', event: deniedRef, similarity: 1 };

  const reactivate = events.find(
    (e) =>
      e.status === 'expired' &&
      actionGroup(e.action) === actionGroup(extracted.action) &&
      ((extracted.subjectCode !== null && e.subjectCode === extracted.subjectCode) ||
        (extracted.subject !== null && normalizeName(e.subject) === normalizeName(extracted.subject))) &&
      ((extracted.objectCode !== null && e.objectCode === extracted.objectCode) ||
        (extracted.object !== null &&
          e.object !== null &&
          normalizeObjectName(e.object) === normalizeObjectName(extracted.object))),
  );
  if (reactivate) return { matchType: 'reactivate', event: reactivate };

  let best: InvestmentEvent | undefined;
  let bestSim = 0;
  for (const e of events) {
    if (e.action !== extracted.action || e.action === 'OTHER') continue;
    const sim = bigramJaccard(`${e.title}${e.summary}`, text);
    if (sim > bestSim) {
      bestSim = sim;
      best = e;
    }
  }
  if (best && bestSim >= FUZZY_THRESHOLD) {
    return { matchType: 'fuzzy', event: best, similarity: bestSim };
  }

  return { matchType: 'new' };
}
