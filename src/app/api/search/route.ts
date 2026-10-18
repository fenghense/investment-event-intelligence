import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';
import { getCninfoAdapter } from '@/lib/adapters/cninfo/adapter';
import { IfindSourceAdapter, ifindConfigured } from '@/lib/adapters/ifind/adapter';
import { fetchMediaNews } from '@/lib/adapters/media/adapter';
import type { RawSourceItem } from '@/lib/domain/types';

// 全局搜索：标的（名/代码/别名）+ 事件（标题/摘要/要素）
// live=1：并行拉取巨潮公告/iFinD 新闻/财经媒体并接入主链路（幂等 dedup），
// 保证搜真实公司名/股票代码时能检索出最新梳理过的事件卡片。
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim();
  const live = searchParams.get('live') === '1';
  const store = await getStore();
  if (!q) {
    return NextResponse.json({ q, targets: [], events: [], suggestions: hotSuggestions() });
  }

  const liveReport: {
    ingested: number;
    fetched: number;
    skipped: number;
    errors: string[];
    sources: { key: string; status: 'ok' | 'empty' | 'failed'; count: number; error?: string }[];
  } = { ingested: 0, fetched: 0, skipped: 0, errors: [], sources: [] };

  if (live) {
    const rawItems: RawSourceItem[] = [];
    const days = 30;
    const start = isoDate(days);
    const end = isoDate(0);
    const [cn, ifind, media] = await Promise.allSettled([
      getCninfoAdapter().fetchLatest({ keyword: q, days, pageSize: 12 }),
      ifindConfigured()
        ? new IfindSourceAdapter().fetchLiveNews(q, start, end, 10)
        : Promise.reject<never>(new Error('IFIND_MCP_URL / IFIND_API_TOKEN 未配置')),
      fetchMediaNews({ size: 12 }),
    ]);
    if (cn.status === 'fulfilled') {
      rawItems.push(...cn.value.items);
      liveReport.sources.push({ key: 'cninfo', status: cn.value.items.length > 0 ? 'ok' : 'empty', count: cn.value.items.length });
    } else {
      liveReport.sources.push({ key: 'cninfo', status: 'failed', count: 0, error: String(cn.reason).slice(0, 160) });
    }
    if (ifind.status === 'fulfilled') {
      rawItems.push(...ifind.value.items);
      liveReport.sources.push({ key: 'ifind', status: ifind.value.items.length > 0 ? 'ok' : 'empty', count: ifind.value.items.length });
    } else {
      liveReport.sources.push({ key: 'ifind', status: 'failed', count: 0, error: String(ifind.reason).slice(0, 160) });
    }
    if (media.status === 'fulfilled') {
      const all = media.value.results.flatMap((r) => r.items);
      const hit = all.filter((it) => it.title.includes(q) || it.content.includes(q));
      rawItems.push(...hit);
      liveReport.sources.push({ key: 'media', status: hit.length > 0 ? 'ok' : 'empty', count: hit.length });
    } else {
      liveReport.sources.push({ key: 'media', status: 'failed', count: 0, error: String(media.reason).slice(0, 160) });
    }

    liveReport.fetched = rawItems.length;
    // q 若像实体名（公司/产品名），注入 companyName 辅助主链路归属：
    // 散文式媒体资讯规则抽取无法识别主体时，仍可归入「特斯拉」卡片；通用词不注入防滥用。
    const qAsEntity = isEntityLike(q);
    for (const raw of rawItems) {
      const item =
        qAsEntity && !raw.rawFields?.secName
          ? { ...raw, rawFields: { ...(raw.rawFields ?? {}), companyName: q } }
          : raw;
      try {
        const res = await store.ingest(item, { extractorMode: 'rules', requireSubject: true });
        if (res.decision.matchType === 'new') liveReport.ingested += 1;
      } catch (err) {
        liveReport.skipped += 1;
        if (liveReport.errors.length < 3) {
          liveReport.errors.push(err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120));
        }
      }
    }
  }

  const targets = store
    .listTargets()
    .filter(
      (t) =>
        t.name.includes(q) ||
        t.code.includes(q) ||
        (t.aliases ?? []).some((a) => a.includes(q) || q.includes(a)),
    );

  const targetCodes = new Set(targets.map((t) => t.code));
  const events = store
    .listEvents()
    .filter((e) => {
      if (e.title.includes(q) || e.summary.includes(q)) return true;
      if (e.subject.includes(q) || e.object.includes(q)) return true;
      return e.targets.some((t) => targetCodes.has(t.code) || t.name.includes(q));
    })
    .map((e) => ({ ...e, favorited: store.isFavorited(e.id), sourceNames: store.sourceNamesOf(e.id) }));

  const suggestions: string[] = [];
  if (events.length === 0) {
    const broad = q.replace(/(股份有限公司|有限责任公司|有限公司|公司)/g, '').trim();
    if (broad && broad !== q) suggestions.push(broad);
    suggestions.push(...hotSuggestions().filter((s) => s !== q));
  }

  return NextResponse.json({
    q,
    targets,
    events,
    suggestions: [...new Set(suggestions)].slice(0, 5),
    emptyHints:
      events.length === 0
        ? live
          ? ['该时间窗内巨潮/iFinD/财经媒体均无相关披露', '试试公司简称或股票代码（如 300750）', '或换用更宽泛的关键词']
          : ['标的不存在或未收录', '时间范围内无披露', '试试更宽泛的关键词（如去掉"股份/有限公司"后缀）']
        : [],
    live: live ? liveReport : undefined,
  });
}

/** 通用词黑名单：动作/披露/行情类词不是公司实体，禁止注入 companyName */
const NON_ENTITY_WORDS = new Set([
  '收购', '并购', '定增', '减持', '增持', '回购', '质押', '解押', '澄清', '传闻', '传闻澄清',
  '业绩', '分红', '派息', '公告', '年报', '季报', '半年报', '涨价', '跌停', '涨停', '上市',
  '退市', '罚款', '调研', '中标', '签约', '合作', '融资', '授信', '担保', '诉讼', '仲裁',
]);

/** q 是否像实体名（公司/产品/人物）：2-12 字、非纯数字、非通用词 */
function isEntityLike(q: string): boolean {
  if (q.length < 2 || q.length > 12) return false;
  if (/^\d{4,}$/.test(q)) return false;
  if (NON_ENTITY_WORDS.has(q)) return false;
  return true;
}

function isoDate(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86400000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hotSuggestions(): string[] {
  return ['收购', '定增', '减持', '传闻澄清', '质押'];
}
