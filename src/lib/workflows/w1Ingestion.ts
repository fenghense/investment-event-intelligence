import { IfindSourceAdapter, ifindConfigured } from '@/lib/adapters/ifind/adapter';
import { getCninfoAdapter } from '@/lib/adapters/cninfo/adapter';
import { fetchMediaNews } from '@/lib/adapters/media/adapter';
import { extractByRules, entitiesFromTargets } from '@/lib/domain/extract';
import { SEED_TARGETS } from '@/lib/server/seed';
import { buildDedupKey, normalizeName, actionGroup } from '@/lib/domain/dedup';
import { ACTION_LABELS, eventTitle } from '@/lib/domain/vocabulary';
import type { ExtractedElements, RawSourceItem } from '@/lib/domain/types';
import { getStore } from '@/lib/server/store';
import { callLlmJson, timedAsync, type WorkflowNodeTrace, type WorkflowWarning } from './types';

// ============================================================
// 工作流 1：事件采集与去重（Event Ingestion & Dedup）
// 触发：手动输入股票代码/标的名（定时任务复用同一入口）
// 数据采集：iFinD MCP（公告+新闻）→ 缓存/演示降级；网络资讯源预留
// LLM 节点：事件实体链接——判断两条信息是否为同一事件（语义匹配）
// 输出：去重后的事件清单，每个事件有唯一 event_id
// ============================================================

export interface W1Input {
  query: string;
  timeStart: string;
  timeEnd: string;
  size?: number;
  useLlmLinking?: boolean;
  forwardHeaders?: Record<string, string>;
}

export interface LinkDecision {
  clusterA: string;
  clusterB: string;
  same: boolean;
  confidence: number;
  reason: string;
  engine: 'llm' | 'llm-fallback' | 'rules';
}

export interface W1Cluster {
  eventId: string;
  dedupKey: string;
  title: string;
  subject: string | null;
  subjectCode: string | null;
  action: string;
  actionLabel: string;
  object: string | null;
  objectCode: string | null;
  eventTime: string | null;
  memberIds: string[];
  sourceCount: number;
  mergedByLlm: boolean;
}

export interface W1Result {
  nodes: WorkflowNodeTrace[];
  warnings: WorkflowWarning[];
  clusters: W1Cluster[];
  linkDecisions: LinkDecision[];
  quota: { mcpCalls: number };
  origin: string;
}

interface ScoredItem {
  raw: RawSourceItem;
  extracted: ExtractedElements;
  dedupKey: string;
}

function clusterTitle(ex: ExtractedElements, raw: RawSourceItem): string {
  if (ex.subject && ex.action && ex.action !== 'OTHER') {
    return eventTitle(ex.subject, ex.action, ex.object);
  }
  if (ex.subject) return `${ex.subject}·${titleNorm(raw.title).slice(0, 24) || raw.title}`;
  return raw.title;
}

/** 标题归一化：去披露类前缀关键词/日期/标点，用于跨源同题归并与相似度判定 */
function titleNorm(t: string): string {
  return t
    .replace(/海外监管公告|H股公告|港股公告/g, '')
    .replace(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g, '')
    .replace(/[\s:：,，.。、;；\-—_（）()《》「」【】"'"'"]/g, '');
}

/** 字符 bigram Jaccard 相似度 */
function titleSimilarity(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const g = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
    if (s.length === 1) g.add(s);
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const x of ga) if (gb.has(x)) inter++;
  return inter / (ga.size + gb.size - inter);
}

function entityOverlap(a: ScoredItem, b: ScoredItem): boolean {
  const namesOf = (x: ScoredItem): Set<string> => {
    const s = new Set<string>();
    if (x.extracted.subject) s.add(normalizeName(x.extracted.subject));
    if (x.extracted.object) s.add(normalizeName(x.extracted.object));
    return s;
  };
  const sa = namesOf(a);
  const sb = namesOf(b);
  for (const n of sa) if (n && sb.has(n)) return true;
  return false;
}

function buildLlmLinkPrompt(a: ScoredItem, b: ScoredItem): string {
  const fmt = (x: ScoredItem): string =>
    `【信息${x === a ? 'A' : 'B'}】标题：${x.raw.title}\n要素：主体=${x.extracted.subject ?? '未知'}，动作=${x.extracted.action}(${ACTION_LABELS[x.extracted.action]})，对象=${x.extracted.object ?? '未知'}，时间=${x.extracted.time ?? '未知'}\n摘要：${x.raw.content.slice(0, 120)}`;
  return `你是金融事件实体链接专家。判断以下两条信息是否描述"同一个投资事件"。
判定标准：
1. 核心要素（谁、做了什么、对谁）一致即视为同一事件，即使表述差异很大（如"A公司收购B公司20%股权"与"A公司拟认购B公司定向增发股份"是同一事件）；总主体一致时应着重考虑，尽量合并。
2. 同一事项的进展/演化节点属于同一投资事件：如"回购方案"→"回购进展"→"回购完成"、"收购预案"→"股东大会通过"→"交割完成"、同一增持计划的多次进展披露，即使日期不同也应判 same=true。
3. 仅当核心要素不同（不同对象、不同行为、互不相关的事项）才判 same=false。
${fmt(a)}
${fmt(b)}
仅输出 JSON：{"same": true/false, "confidence": 0-1, "reason": "一句话理由"}`;
}

export async function runW1EventIngestion(input: W1Input): Promise<W1Result> {
  const nodes: WorkflowNodeTrace[] = [];
  const warnings: WorkflowWarning[] = [];
  const size = Math.min(Math.max(input.size ?? 5, 1), 20);
  const adapter = new IfindSourceAdapter();

  // ---- 节点 1：数据采集（多源并行：iFinD 公告+新闻 / 巨潮公开公告 / 财经媒体资讯） ----
  const q = input.query.trim();
  const collect = await timedAsync(async () => {
    const [ifindRes, cninfoRes, mediaRes] = await Promise.all([
      adapter.fetchByTargetRange(q, input.timeStart, input.timeEnd, size),
      getCninfoAdapter()
        .fetchLatest({ keyword: q, start: input.timeStart, end: input.timeEnd, pageSize: size })
        .then((res) => ({ items: res.items, error: undefined as string | undefined }))
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          return { items: [] as RawSourceItem[], error: msg };
        }),
      fetchMediaNews({ size: 30 })
        .then((agg) => {
          const hit = agg.results.flatMap((r) =>
            r.items.filter((it) => it.title.includes(q) || it.content.includes(q)),
          );
          return { items: hit, failures: agg.failures };
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          return { items: [] as RawSourceItem[], failures: [{ key: 'media', error: msg }] };
        }),
    ]);
    const merged = [...ifindRes.items, ...cninfoRes.items, ...mediaRes.items];
    merged.sort((a, b) => b.disclosedAt.localeCompare(a.disclosedAt));
    const sourceParts: string[] = [
      `iFinD(${ifindConfigured() ? '已配置' : '未配置'})：${ifindRes.sources.map((s) => `${s.tool}=${s.count}(${s.origin})`).join('，')}`,
      `巨潮公告=${cninfoRes.items.length}${cninfoRes.error ? `（不可用：${cninfoRes.error}）` : ''}`,
      `财经媒体=${mediaRes.items.length}${mediaRes.failures.length ? `（${mediaRes.failures.length} 源失败）` : ''}`,
    ];
    return {
      items: merged.slice(0, Math.max(size * 2, 10)),
      sourceDetail: sourceParts.join('；'),
      ifindWarnings: ifindRes.warnings,
      quota: ifindRes.quota,
      origin: ifindRes.origin,
    };
  });
  nodes.push({
    node: '数据采集',
    engine: 'system',
    durationMs: collect.ms,
    items: collect.value.items.length,
    detail: collect.value.sourceDetail,
  });
  warnings.push(...collect.value.ifindWarnings.map((w) => ({ stage: w.stage, message: w.message })));

  const items = collect.value.items;
  if (items.length === 0) {
    return { nodes, warnings, clusters: [], linkDecisions: [], quota: collect.value.quota, origin: collect.value.origin };
  }

  // ---- 节点 2：要素抽取（规则默认；实体库 = 种子标的 + 已建档真实标的；rawFields 证券信息兜底） ----
  const store = await getStore();
  const knownEntities = store
    .subjectCandidates()
    .filter((c): c is { code: string; name: string; aliases: string[] } => Boolean(c.code))
    .map((c) => ({ code: c.code, name: c.name, aliases: c.aliases }));
  const entities = [...entitiesFromTargets(SEED_TARGETS), ...knownEntities];
  const extractRun = await timedAsync(async () => {
    const out: ScoredItem[] = [];
    for (const raw of items) {
      const text = `${raw.title}\n${raw.content}`;
      const ex = extractByRules(text, entities);
      // 与主链路 ingest 第 1.5 步同规：实时源 rawFields 注入的证券简称/代码兜底主体
      if (!ex.subject) {
        const secName = (raw.rawFields?.secName ?? raw.rawFields?.companyName) as string | undefined;
        if (secName?.trim()) {
          ex.subject = secName.trim();
          const codes = raw.rawFields?.stockCodes as string[] | undefined;
          if (!ex.subjectCode && codes?.[0]) ex.subjectCode = codes[0];
        }
      }
      out.push({
        raw,
        extracted: ex,
        dedupKey: buildDedupKey({
          subject: ex.subject, subjectCode: ex.subjectCode, action: ex.action,
          object: ex.object, objectCode: ex.objectCode, time: ex.time ?? raw.disclosedAt.slice(0, 10),
        }),
      });
    }
    return out;
  });
  nodes.push({
    node: '要素抽取',
    engine: 'rules',
    durationMs: extractRun.ms,
    items: extractRun.value.length,
    detail: `规则抽取主体/动作/对象/时间（实体库 ${entities.length} 条：种子+已建档标的），动作归一至受控词表`,
  });

  // ---- 节点 3a：确定性去重（dedup_key 精确聚类） ----
  const scored = extractRun.value;
  const clusterOf = new Map<string, ScoredItem[]>();
  scored.forEach((s, i) => {
    // 时间窗口未知时放宽：同主体+动作组+对象即并簇
    let key = s.dedupKey;
    const exact = clusterOf.get(key);
    if (exact) {
      exact.push(s);
      return;
    }
    const parts = key.split('|');
    for (const [k, members] of clusterOf) {
      const kp = k.split('|');
      const windowOk = parts[3] === 'unknown' || kp[3] === 'unknown' || parts[3] === kp[3];
      if (parts[0] === kp[0] && actionGroup(parts[1]) === actionGroup(kp[1]) && parts[2] === kp[2] && windowOk) {
        members.push(s);
        return;
      }
    }
    clusterOf.set(`${key}#${i}`, [s]);
  });
  // ---- 节点 3a+：标题归一化规则归并——跨源同题（「海外监管公告/H股公告」前缀、日期、公司名前缀差异） ----
  const normGroups: ScoredItem[][] = [];
  for (const [, members] of clusterOf) {
    let placed = false;
    for (const g of normGroups) {
      const ra = g[0];
      const rb = members[0];
      const ta = titleNorm(ra.raw.title);
      const tb = titleNorm(rb.raw.title);
      const sameSubject =
        !ra.extracted.subject ||
        !rb.extracted.subject ||
        normalizeName(ra.extracted.subject) === normalizeName(rb.extracted.subject);
      const titleSame =
        ta === tb || (ta.length >= 8 && tb.includes(ta)) || (tb.length >= 8 && ta.includes(tb));
      if (sameSubject && titleSame) {
        g.push(...members);
        placed = true;
        break;
      }
    }
    if (!placed) normGroups.push([...members]);
  }
  let clusters = normGroups.map((members, i) => ({
    clusterKey: `${members[0].dedupKey}#t${i}`,
    members,
    representative: members.reduce((a, b) => (a.raw.disclosedAt <= b.raw.disclosedAt ? a : b)),
  }));

  // ---- 节点 3b：LLM 实体链接（跨簇语义去重，最多判定 5 对） ----
  const linkDecisions: LinkDecision[] = [];
  const candidatePairs: Array<[number, number]> = [];
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const ra = clusters[i].representative;
      const rb = clusters[j].representative;
      // 候选条件：要素主体重叠，或标题归一化后高相似（跨源同事件的不同表述）
      if (
        entityOverlap(ra, rb) ||
        titleSimilarity(titleNorm(ra.raw.title), titleNorm(rb.raw.title)) >= 0.55
      ) {
        candidatePairs.push([i, j]);
      }
    }
  }
  // 候选对按「标题相似度×0.6 + 要素重叠×0.4」降序，优先把最可能同事件的对送 LLM（限流 5 对）
  const rankedPairs = candidatePairs
    .map(([i, j]) => {
      const ra = clusters[i].representative;
      const rb = clusters[j].representative;
      const sim = titleSimilarity(titleNorm(ra.raw.title), titleNorm(rb.raw.title));
      return { pair: [i, j] as [number, number], score: sim * 0.6 + (entityOverlap(ra, rb) ? 0.4 : 0) };
    })
    .sort((a, b) => b.score - a.score);
  const limitedPairs = rankedPairs.slice(0, 5).map((p) => p.pair);
  if (input.useLlmLinking && limitedPairs.length > 0) {
    const linkRun = await timedAsync(async () => {
      for (const [i, j] of limitedPairs) {
        const ra = clusters[i].representative;
        const rb = clusters[j].representative;
        try {
          const r = await callLlmJson<{ same: boolean; confidence: number; reason: string }>(
            buildLlmLinkPrompt(ra, rb), input.forwardHeaders, 25_000,
          );
          linkDecisions.push({
            clusterA: ra.raw.title, clusterB: rb.raw.title,
            same: Boolean(r.same), confidence: r.confidence ?? 0, reason: r.reason ?? '',
            engine: 'llm',
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          linkDecisions.push({
            clusterA: ra.raw.title, clusterB: rb.raw.title,
            same: false, confidence: 0, reason: `LLM 判定失败，保持分簇：${msg}`,
            engine: 'llm-fallback',
          });
          warnings.push({ stage: 'llm-linking', message: `LLM 实体链接失败，该对保持分簇：${msg}` });
        }
      }
      return linkDecisions.length;
    });
    nodes.push({
      node: 'LLM 实体链接',
      engine: linkDecisions.some((d) => d.engine === 'llm-fallback') ? 'llm-fallback' : 'llm',
      durationMs: linkRun.ms,
      items: limitedPairs.length,
      detail: `对 ${limitedPairs.length} 对跨簇候选做语义同事件判定` +
        (candidatePairs.length > 5 ? `（候选共 ${candidatePairs.length} 对，限流取前 5 对）` : ''),
    });
    // 并查集合并 LLM 判定为同一事件的簇
    const parent = clusters.map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    limitedPairs.forEach(([i, j], k) => {
      const d = linkDecisions[k];
      if (d?.same && d.confidence >= 0.6) parent[find(i)] = find(j);
    });
    const merged = new Map<number, typeof clusters>();
    clusters.forEach((c, i) => {
      const root = find(i);
      merged.set(root, [...(merged.get(root) ?? []), c]);
    });
    clusters = [...merged.values()].map((group) => {
      const members = group.flatMap((g) => g.members);
      const representative = members.reduce((a, b) => (a.raw.disclosedAt <= b.raw.disclosedAt ? a : b));
      return { clusterKey: group[0].clusterKey, members, representative };
    });
  } else {
    nodes.push({
      node: 'LLM 实体链接',
      engine: 'rules',
      durationMs: 0,
      items: candidatePairs.length,
      detail: input.useLlmLinking
        ? '无跨簇候选对，跳过 LLM 判定'
        : `未开启 LLM 判定（useLlmLinking=false），${candidatePairs.length} 对候选保持规则分簇`,
    });
  }

  // ---- 输出：去重后事件清单 ----
  const out: W1Cluster[] = clusters
    .map((c, idx) => {
      const ex = c.representative.extracted;
      return {
        eventId: `W1E-${String(idx + 1).padStart(3, '0')}`,
        dedupKey: c.representative.dedupKey,
        title: clusterTitle(ex, c.representative.raw),
        subject: ex.subject, subjectCode: ex.subjectCode,
        action: ex.action, actionLabel: ACTION_LABELS[ex.action],
        object: ex.object, objectCode: ex.objectCode,
        eventTime: ex.time,
        memberIds: c.members.map((m) => m.raw.externalId),
        sourceCount: new Set(c.members.map((m) => m.raw.sourceName)).size,
        mergedByLlm: c.members.length > 0 && linkDecisions.some(
          (d) => d.same && c.members.some((m) => m.raw.title === d.clusterA || m.raw.title === d.clusterB),
        ),
      };
    })
    .sort((a, b) => b.memberIds.length - a.memberIds.length);

  return { nodes, warnings, clusters: out, linkDecisions, quota: collect.value.quota, origin: collect.value.origin };
}
