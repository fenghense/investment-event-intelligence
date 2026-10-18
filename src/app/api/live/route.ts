import { NextRequest, NextResponse } from 'next/server';
import type { RawSourceItem } from '@/lib/domain/types';
import { getCninfoAdapter } from '@/lib/adapters/cninfo/adapter';
import { IfindSourceAdapter, ifindConfigured, daysToTrendingScope, IFIND_MAX_SIZE } from '@/lib/adapters/ifind/adapter';
import { registerLiveItems } from '@/lib/adapters/liveRegistry';
import { fetchMediaNews, MEDIA_PROVIDER_META, ALL_MEDIA_PROVIDERS } from '@/lib/adapters/media/adapter';
import { getStore } from '@/lib/server/store';

// ============================================================
// 多源实时消息汇聚：巨潮公开公告 + iFinD 新闻 / 热门事件 + 财经媒体（36氪/虎嗅/钛媒体）
// 强约束：真实路径绝不返回种子/演示数据。
//   - 每个源独立成功 / 失败 / 空，分别标注 origin
//   - 仅当所有真实源都失败时，顶层 origin='fallback' 并给“数据服务暂不可用”
//   - 远程成功但无结果：origin='remote' + items=[] + emptyHint（不伪造）
//   - 单源失败跳过并记 warning，不影响其他源
// ============================================================

export interface LiveSourceResult {
  provider: 'cninfo' | 'ifind-news' | 'ifind-trending' | `media-${string}`;
  label: string;
  origin: 'remote' | 'cache' | 'unavailable';
  count: number;
  warning?: string;
}

/** 严格实时方法成功时只会返回 remote/cache；收口为源结果可用的联合类型 */
type StrictOrigin = 'remote' | 'cache';

interface LiveBody {
  q?: string;
  keyword?: string;
  days?: number;
  start?: string;
  end?: string;
  time_start?: string;
  time_end?: string;
  timeStart?: string;
  timeEnd?: string;
  sources?: string[];
  industry?: string;
  pageSize?: number;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function normalizeDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(t)) return t.replaceAll('/', '-');
  if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return undefined;
}

export async function POST(request: NextRequest) {
  let body: LiveBody;
  try {
    body = (await request.json()) as LiveBody;
  } catch {
    body = {};
  }

  const keyword = (body.q ?? body.keyword ?? '').trim();
  const days = [1, 7, 30].includes(Number(body.days)) ? Number(body.days) : 7;

  const end =
    normalizeDate(body.end) ?? normalizeDate(body.time_end) ?? normalizeDate(body.timeEnd) ?? fmt(new Date());
  const explicitStart =
    normalizeDate(body.start) ?? normalizeDate(body.time_start) ?? normalizeDate(body.timeStart);
  const start = explicitStart ?? fmt(new Date(Date.now() - (days - 1) * 86_400_000));

  const wanted = new Set<string>(
    Array.isArray(body.sources) && body.sources.length > 0
      ? body.sources
      : ['cninfo', 'ifind-news', 'ifind-trending', 'media'],
  );

  const merged: Array<RawSourceItem & { provider: string }> = [];
  const sourceResults: LiveSourceResult[] = [];
  let anySuccess = false;
  let anyItems = false;

  // ---- 源 1：巨潮公开公告（无凭证，真实实时）----
  if (wanted.has('cninfo')) {
    try {
      const cn = getCninfoAdapter();
      const res = await cn.fetchLatest({
        start,
        end,
        keyword: keyword || undefined,
        pageSize: body.pageSize ?? 20,
      });
      const tagged = res.items.map((it) => ({ ...it, provider: 'cninfo' }));
      merged.push(...tagged);
      registerLiveItems(res.items, 'cninfo');
      anySuccess = true;
      if (res.items.length > 0) anyItems = true;
      sourceResults.push({
        provider: 'cninfo',
        label: '巨潮 cninfo·公告',
        origin: res.origin as StrictOrigin,
        count: res.items.length,
        ...(res.warnings[0] ? { warning: res.warnings[0] } : {}),
      });
    } catch (err) {
      sourceResults.push({
        provider: 'cninfo',
        label: '巨潮 cninfo·公告',
        origin: 'unavailable',
        count: 0,
        warning: `巨潮公告源暂不可用：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ---- 源 2/3：iFinD 新闻 + 热门事件（需凭证；未配置则该源 unavailable，不影响巨潮）----
  if (wanted.has('ifind-news') || wanted.has('ifind-trending')) {
    const ifind = new IfindSourceAdapter();
    const configured = ifindConfigured();

    if (wanted.has('ifind-news')) {
      try {
        if (!configured) throw new Error('IFIND_MCP_URL / IFIND_API_TOKEN 未配置');
        // search_news 必填 query：无关键词时用通用词拉取最新市场资讯；size 收敛到 iFinD 上限
        const res = await ifind.fetchLiveNews(keyword || 'A股', start, end, Math.min(IFIND_MAX_SIZE, body.pageSize ?? 15));
        const tagged = res.items.map((it) => ({ ...it, provider: 'ifind-news' }));
        merged.push(...tagged);
        registerLiveItems(res.items, 'ifind-news');
        anySuccess = true;
        if (res.items.length > 0) anyItems = true;
        sourceResults.push({
          provider: 'ifind-news',
          label: '同花顺 iFinD·新闻',
          origin: res.origin as StrictOrigin,
          count: res.items.length,
          ...(res.items.length === 0
            ? { warning: `iFinD 新闻在该时间窗（${start} ~ ${end}）内无匹配片段` }
            : {}),
        });
      } catch (err) {
        sourceResults.push({
          provider: 'ifind-news',
          label: '同花顺 iFinD·新闻',
          origin: 'unavailable',
          count: 0,
          warning: `iFinD 新闻源暂不可用：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    if (wanted.has('ifind-trending') && !keyword) {
      // 热门事件不接受关键词过滤，仅在未输入关键词时拉取
      try {
        if (!configured) throw new Error('IFIND_MCP_URL / IFIND_API_TOKEN 未配置');
        const scope = daysToTrendingScope(days as 1 | 7 | 30);
        const res = await ifind.fetchTrending(scope, {
          industry: body.industry,
          size: Math.min(IFIND_MAX_SIZE, body.pageSize ?? IFIND_MAX_SIZE),
        });
        const tagged = res.items.map((it) => ({ ...it, provider: 'ifind-trending' }));
        merged.push(...tagged);
        registerLiveItems(res.items, 'ifind-trending');
        anySuccess = true;
        if (res.items.length > 0) anyItems = true;
        sourceResults.push({
          provider: 'ifind-trending',
          label: '同花顺 iFinD·热门事件',
          origin: res.origin as StrictOrigin,
          count: res.items.length,
          ...(days === 30
            ? { warning: 'iFinD 热门事件最长覆盖「近一周」，30 天视图下该源仅含近一周内容' }
            : {}),
        });
      } catch (err) {
        sourceResults.push({
          provider: 'ifind-trending',
          label: '同花顺 iFinD·热门事件',
          origin: 'unavailable',
          count: 0,
          warning: `iFinD 热门事件源暂不可用：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }

  // ---- 源 4：财经媒体（36氪 / 虎嗅 / 钛媒体，真实抓取；单源失败跳过）----
  const wantMedia =
    wanted.has('media') || ALL_MEDIA_PROVIDERS.some((p) => wanted.has(`media-${p}`));
  if (wantMedia) {
    const picked = ALL_MEDIA_PROVIDERS.filter(
      (p) => wanted.has('media') || wanted.has(`media-${p}`),
    );
    const perSource = Math.max(5, Math.min(15, body.pageSize ?? 10));
    const agg = await fetchMediaNews({ providers: picked, size: perSource });

    const startMs = Date.parse(`${start}T00:00:00+08:00`);
    const endMs = Date.parse(`${end}T23:59:59+08:00`);
    const kw = keyword.toLowerCase();

    for (const res of agg.results) {
      // 媒体源为最新列表流：本地按时间窗 + 关键词过滤，保证 1/7/30 天视图纯净
      const filtered = res.items.filter((it) => {
        const t = Date.parse(it.disclosedAt);
        if (!Number.isNaN(t) && (t < startMs || t > endMs)) return false;
        if (kw && !`${it.title} ${it.content}`.toLowerCase().includes(kw)) return false;
        return true;
      });
      const providerKey = `media-${res.provider}` as `media-${string}`;
      const tagged = filtered.map((it) => ({ ...it, provider: providerKey }));
      merged.push(...tagged);
      registerLiveItems(filtered, providerKey);
      anySuccess = true;
      if (filtered.length > 0) anyItems = true;
      sourceResults.push({
        provider: providerKey,
        label: `${MEDIA_PROVIDER_META[res.provider].label}·资讯`,
        origin: res.origin,
        count: filtered.length,
        ...(res.warnings[0] ? { warning: res.warnings[0] } : {}),
        ...(filtered.length === 0 && res.items.length > 0
          ? { warning: `${MEDIA_PROVIDER_META[res.provider].label}最新流在该时间窗/关键词下无匹配` }
          : {}),
      });
    }
    for (const f of agg.failures) {
      sourceResults.push({
        provider: `media-${f.provider}`,
        label: `${f.label}·资讯`,
        origin: 'unavailable',
        count: 0,
        warning: `${f.label}源暂不可用（已跳过，不影响其他源）：${f.message}`,
      });
    }
  }

  // 合并排序：按披露时间倒序；按 externalId 去重（不同源重复报道保留更高可信源）
  const seen = new Set<string>();
  const items = merged
    .sort((a, b) => Date.parse(b.disclosedAt) - Date.parse(a.disclosedAt))
    .filter((it) => {
      if (seen.has(it.externalId)) return false;
      seen.add(it.externalId);
      return true;
    });

  // ---- 主体识别 + 已接入事件回标（前端按公司归组；无主体条目由前端忽略）----
  const store = await getStore();
  const candidates = store
    .subjectCandidates()
    .filter((c) => c.name.trim().length >= 2)
    .sort((a, b) => b.name.length - a.name.length); // 长名优先，防短名误命中
  const enriched = items.map((it) => {
    const rawSecName = it.rawFields?.secName;
    const rawCompany = it.rawFields?.companyName;
    const directName =
      (typeof rawSecName === 'string' && rawSecName.trim()) ||
      (typeof rawCompany === 'string' && rawCompany.trim()) ||
      '';
    let subject: string | undefined;
    let subjectCode: string | undefined;
    if (directName) {
      const hit = candidates.find((c) => c.name === directName || c.aliases.includes(directName));
      subject = hit?.name ?? directName;
      const rawCodes = it.rawFields?.stockCodes;
      const fromRaw =
        Array.isArray(rawCodes) && typeof rawCodes[0] === 'string' && /^\d{6}$/.test(rawCodes[0])
          ? rawCodes[0]
          : undefined;
      subjectCode = hit?.code ?? fromRaw;
    } else {
      const text = `${it.title} ${it.content}`;
      for (const c of candidates) {
        if (text.includes(c.name)) {
          subject = c.name;
          subjectCode = c.code ?? undefined;
          break;
        }
        const aliasHit = c.aliases.find((a) => a.length >= 2 && text.includes(a));
        if (aliasHit) {
          subject = c.name;
          subjectCode = c.code ?? undefined;
          break;
        }
      }
    }
    const eventId = store.findEventIdByExternalId(it.externalId);
    return { ...it, subject, subjectCode, eventId };
  });

  const topOrigin: 'remote' | 'cache' | 'fallback' = anySuccess
    ? sourceResults.some((s) => s.origin === 'remote')
      ? 'remote'
      : 'cache'
    : 'fallback';

  const warnings: string[] = [];
  if (topOrigin === 'fallback') {
    warnings.push('数据服务暂不可用：所有实时数据源（巨潮 / iFinD / 财经媒体）均未成功，请稍后重试或检查数据源配置。页面不展示任何演示数据。');
  }
  for (const s of sourceResults) {
    if (s.warning && s.origin === 'unavailable') warnings.push(s.warning);
  }

  const emptyHint =
    topOrigin !== 'fallback' && !anyItems
      ? `该时间窗（${start} ~ ${end}）内无匹配的实时消息，可尝试：扩大时间范围 / 更换更宽泛的关键词 / 清空关键词查看全部最新公告`
      : undefined;

  return NextResponse.json({
    items: enriched,
    count: enriched.length,
    subjectCount: enriched.filter((it) => it.subject).length,
    origin: topOrigin,
    sources: sourceResults,
    warnings,
    emptyHint,
    timeRange: { start, end, usedDefaultWindow: !explicitStart, days },
    fetchedAt: new Date().toISOString(),
  });
}
