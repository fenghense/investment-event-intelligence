import type { RawSourceItem } from '@/lib/domain/types';

// ============================================================
// 财经媒体资讯源（真实抓取，禁止伪造）
//   36氪：官方 gateway 热榜 API（POST gateway.36kr.com，实测 code:0）
//   虎嗅：官方 RSS（rss.huxiu.com，实测返回真实 item 流）
//   钛媒体：官方 RSS（tmtpost.com/rss.xml，实测返回真实 item 流）
// 约束：
//   - 每条必须标注来源媒体名 + 原文链接 + 发布时间 + rawSnapshot
//   - 单源失败 / 限流 / 超时 → 跳过该源并在 failures 中说明，不影响其他源
//   - 无额度限制但有超时（10s）+ 1 次重试 + 10min 进程内缓存保护
// ============================================================

export type MediaProvider = 'kr36' | 'huxiu' | 'tmtpost';

export const MEDIA_PROVIDER_META: Record<MediaProvider, { label: string; sourceName: string }> = {
  kr36: { label: '36氪', sourceName: '36氪·热门资讯' },
  huxiu: { label: '虎嗅', sourceName: '虎嗅·商业资讯' },
  tmtpost: { label: '钛媒体', sourceName: '钛媒体·财经科技' },
};

export const ALL_MEDIA_PROVIDERS: MediaProvider[] = ['kr36', 'huxiu', 'tmtpost'];

export interface MediaSourceResult {
  provider: MediaProvider;
  label: string;
  origin: 'remote' | 'cache';
  items: RawSourceItem[];
  fetchedAt: string;
  warnings: string[];
}

export interface MediaFailure {
  provider: MediaProvider;
  label: string;
  message: string;
}

export interface MediaAggregateResult {
  results: MediaSourceResult[];
  failures: MediaFailure[];
}

const TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------- 基础工具 ----------------

function shortHash(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36).toUpperCase();
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripHtml(s: string): string {
  return stripCdata(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { 'User-Agent': UA, Accept: '*/*', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // 重试 1 次（限流/抖动场景）
    await new Promise((r) => setTimeout(r, 800));
    return fn();
  }
}

// ---------------- RSS 解析（Node 无 DOM，正则提取） ----------------

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  guid: string;
}

function pickTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? stripCdata(m[1]).trim() : '';
}

export function parseRss(xml: string, maxItems: number): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks.slice(0, maxItems)) {
    const title = pickTag(block, 'title');
    const link = pickTag(block, 'link');
    if (!title || !link) continue;
    items.push({
      title: stripHtml(title),
      link,
      pubDate: pickTag(block, 'pubDate'),
      description: stripHtml(pickTag(block, 'description') || pickTag(block, 'summary')),
      guid: pickTag(block, 'guid') || pickTag(block, 'id') || link,
    });
  }
  return items;
}

function toIso(pubDate: string): string | null {
  if (!pubDate) return null;
  const t = Date.parse(pubDate);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---------------- 各媒体实现 ----------------

const cache = new Map<MediaProvider, { at: number; items: RawSourceItem[] }>();

function fromCache(provider: MediaProvider): RawSourceItem[] | null {
  const hit = cache.get(provider);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.items;
  return null;
}

async function fetchRssSource(provider: MediaProvider, url: string, size: number): Promise<RawSourceItem[]> {
  const xml = await withRetry(() => fetchText(url));
  const meta = MEDIA_PROVIDER_META[provider];
  const now = new Date().toISOString();
  return parseRss(xml, size).map((it) => {
    const disclosedAt = toIso(it.pubDate) ?? now;
    return {
      externalId: `${provider.toUpperCase()}-${shortHash(it.guid)}`,
      sourceType: 'media' as const,
      sourceName: meta.sourceName,
      title: it.title,
      content: truncate(it.description || it.title, 220),
      url: it.link,
      announcementNo: undefined,
      disclosedAt,
      fetchedAt: now,
      meta: {},
      rawSnapshot: { guid: it.guid, pubDate: it.pubDate },
    };
  });
}

interface Kr36RankItem {
  itemId: number;
  templateMaterial?: {
    itemId?: number;
    widgetTitle?: string;
    widgetSummary?: string;
    publishTime?: number;
    authorName?: string;
    statFormat?: string;
  };
}

async function fetchKr36(size: number): Promise<RawSourceItem[]> {
  const body = {
    partner_id: 'web',
    timestamp: Date.now(),
    param: { siteId: 1, platformId: 2 },
  };
  const text = await withRetry(() =>
    fetchText('https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  const json = JSON.parse(text) as { code?: number; msg?: string; data?: { hotRankList?: Kr36RankItem[] } };
  if (json.code !== 0) throw new Error(`36氪接口返回 code=${json.code} msg=${json.msg ?? ''}`);
  const list = json.data?.hotRankList ?? [];
  const now = new Date().toISOString();
  return list.slice(0, size).flatMap((entry): RawSourceItem[] => {
    const m = entry.templateMaterial;
    const id = m?.itemId ?? entry.itemId;
    const title = m?.widgetTitle?.trim();
    if (!id || !title) return [];
    const disclosedAt = m?.publishTime ? new Date(m.publishTime).toISOString() : now;
    const summary = m?.widgetSummary?.trim();
    return [
      {
        externalId: `KR36-${id}`,
        sourceType: 'media' as const,
        sourceName: MEDIA_PROVIDER_META.kr36.sourceName,
        title,
        content: truncate(summary || title, 220),
        url: `https://36kr.com/p/${id}`,
        announcementNo: undefined,
        disclosedAt,
        fetchedAt: now,
        meta: {},
        rawSnapshot: {
          itemId: id,
          authorName: m?.authorName ?? null,
          statFormat: m?.statFormat ?? null,
          publishTime: m?.publishTime ?? null,
        },
      },
    ];
  });
}

async function fetchOne(provider: MediaProvider, size: number): Promise<{ origin: 'remote' | 'cache'; items: RawSourceItem[] }> {
  const cached = fromCache(provider);
  if (cached) return { origin: 'cache', items: cached.slice(0, size) };

  const items =
    provider === 'kr36'
      ? await fetchKr36(size)
      : provider === 'huxiu'
        ? await fetchRssSource('huxiu', 'https://rss.huxiu.com', size)
        : await fetchRssSource('tmtpost', 'https://www.tmtpost.com/rss.xml', size);

  if (items.length > 0) cache.set(provider, { at: Date.now(), items });
  return { origin: 'remote', items };
}

// ---------------- 对外入口：并行汇聚，单源失败不拖垮整体 ----------------

export async function fetchMediaNews(options?: {
  providers?: MediaProvider[];
  size?: number;
}): Promise<MediaAggregateResult> {
  const providers = options?.providers?.length ? options.providers : ALL_MEDIA_PROVIDERS;
  const size = options?.size ?? 10;

  const settled = await Promise.allSettled(providers.map((p) => fetchOne(p, size)));

  const results: MediaSourceResult[] = [];
  const failures: MediaFailure[] = [];

  settled.forEach((res, i) => {
    const provider = providers[i];
    const meta = MEDIA_PROVIDER_META[provider];
    if (res.status === 'fulfilled') {
      results.push({
        provider,
        label: meta.label,
        origin: res.value.origin,
        items: res.value.items,
        fetchedAt: new Date().toISOString(),
        warnings: res.value.items.length === 0 ? [`${meta.label}源返回为空（可能限流或源站结构调整）`] : [],
      });
    } else {
      failures.push({
        provider,
        label: meta.label,
        message: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  });

  return { results, failures };
}
