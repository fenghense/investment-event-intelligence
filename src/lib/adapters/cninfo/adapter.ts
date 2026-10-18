import type { RawSourceItem, SourceType } from '@/lib/domain/types';

// ============================================================
// 巨潮资讯网（cninfo）公开公告源 —— 真实实时数据，无需凭证
// ------------------------------------------------------------
// 数据接口：POST https://www.cninfo.com.cn/new/hisAnnouncement/query
//   body(x-www-form-urlencoded): pageNum/pageSize/seDate(YYYY-MM-DD~YYYY-MM-DD)/
//     column('' 全市场 / 'sse' 沪 / 'szse' 深 / 'bj' 北)/tabName=fulltext/
//     searchkey/stock/sortName/sortType/clusterFlag
//   返回 { totalAnnouncement, announcements: [...] }
// 原文链接：https://static.cninfo.com.cn + adjunctUrl
// 本适配器为公开实时源：任何情况下都不返回种子/演示数据；失败即抛错，
// 由上层汇聚接口统一显式降级（origin='fallback' + “数据服务暂不可用”）。
// ============================================================

const QUERY_URL = 'https://www.cninfo.com.cn/new/hisAnnouncement/query';
const STATIC_BASE = 'https://static.cninfo.com.cn';
const DEFAULT_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [600, 1_400];
/** 列表结果短缓存，避免高频刷公开接口；公告是准实时的，5 分钟足够 */
const CACHE_TTL_MS = 5 * 60_000;
const MAX_PAGE_SIZE = 30;

export type CninfoColumn = '' | 'sse' | 'szse' | 'bj';

export interface CninfoFetchOptions {
  /** 最近 N 天（与显式 start/end 二选一） */
  days?: number;
  start?: string;
  end?: string;
  /** 关键词（公司名 / 公告关键词，如“增持”） */
  keyword?: string;
  /** 市场板块，默认空 = 全市场 */
  column?: CninfoColumn;
  pageSize?: number;
}

export interface CninfoFetchResult {
  items: RawSourceItem[];
  total: number;
  origin: 'remote' | 'cache';
  timeRange: { start: string; end: string };
  warnings: string[];
}

interface CninfoAnnouncementRow {
  announcementId?: string | number;
  announcementTitle?: string;
  announcementTime?: number; // 毫秒时间戳
  adjunctUrl?: string;
  secCode?: string;
  secName?: string;
  orgId?: string;
  columnId?: string;
  pageColumn?: string;
  announcementType?: string;
  adjunctType?: string;
  [key: string]: unknown;
}

interface CninfoQueryResponse {
  totalAnnouncement?: number;
  announcements?: CninfoAnnouncementRow[] | null;
  classifiedAnnouncements?: unknown;
}

interface CacheEntry {
  at: number;
  total: number;
  timeRange: { start: string; end: string };
  items: RawSourceItem[];
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function resolveWindow(opts: CninfoFetchOptions): { start: string; end: string } {
  const end = opts.end ? new Date(`${opts.end}T23:59:59`) : new Date();
  let start: Date;
  if (opts.start) {
    start = new Date(`${opts.start}T00:00:00`);
  } else {
    const days = Math.max(1, opts.days ?? 7);
    start = new Date(end.getTime() - (days - 1) * 86_400_000);
  }
  return { start: formatDate(start), end: formatDate(end) };
}

/** 简易公告类型推断（用于证据分级，不改变原文标题） */
function detectBulletinType(title: string): string | undefined {
  if (/更正|修正|勘误/.test(title)) return '更正公告';
  if (/澄清|否认|辟谣|传闻/.test(title)) return '澄清公告';
  if (/增持|减持/.test(title)) return '增减持公告';
  if (/收购|并购|重组|吸收合并/.test(title)) return '并购重组公告';
  if (/认购|定向增发|定增|非公开发行/.test(title)) return '定增公告';
  if (/质押|解押/.test(title)) return '股权质押公告';
  if (/年报|年度报告/.test(title)) return '定期报告';
  if (/季报|半年度报告|业绩/.test(title)) return '定期报告';
  if (/进展/.test(title)) return '进展公告';
  return undefined;
}

function mapRow(row: CninfoAnnouncementRow, fetchedAt: string): RawSourceItem | null {
  const title = (row.announcementTitle ?? '').replace(/<[^>]+>/g, '').trim();
  const id = row.announcementId != null ? String(row.announcementId) : '';
  if (!title || !id) return null;
  const disclosedAt =
    typeof row.announcementTime === 'number' && row.announcementTime > 0
      ? new Date(row.announcementTime).toISOString()
      : fetchedAt;
  const url = row.adjunctUrl ? `${STATIC_BASE}/${row.adjunctUrl.replace(/^\/+/, '')}` : undefined;
  // isHLtitle=true 时 secName/标题可能带 <em> 高亮标签，必须清洗
  const secName = (row.secName ?? '').replace(/<[^>]+>/g, '').trim();
  const secCode = (row.secCode ?? '').replace(/<[^>]+>/g, '').trim();
  const bulletinType = detectBulletinType(title);
  return {
    externalId: `CNINFO-${id}`,
    sourceType: 'announcement' as SourceType,
    sourceName: '巨潮资讯网·法定信息披露',
    title,
    // 列表接口不返回正文片段，正文以 PDF 原文为准；content 用标题，绝不伪造摘要
    content: secName ? `${secName}（${secCode}）：${title}` : title,
    ...(url ? { url } : {}),
    announcementNo: id,
    disclosedAt,
    fetchedAt,
    meta: {
      ...(bulletinType ? { bulletinType } : {}),
      evidenceType: 'fact',
      officialConfirm: true,
      sourceHitRate: 0.97,
    },
    rawSnapshot: { ...row, staticPdfUrl: url },
    // 结构化证券字段：主链路据此为真实公司补码/自动建档
    rawFields: { ...(secCode ? { stockCodes: [secCode] } : {}), ...(secName ? { secName } : {}) },
    origin: 'remote',
  };
}

class CninfoLiveAdapter {
  readonly name = 'cninfo';
  private readonly cache = new Map<string, CacheEntry>();
  /** 最近一次拉取结果，供按 externalId 精确取条目（live ingest） */
  private readonly byId = new Map<string, RawSourceItem>();

  isConfigured(): boolean {
    // 公开接口，恒可用（网络层失败另算）
    return true;
  }

  private cacheKey(opts: {
    start: string;
    end: string;
    keyword: string;
    column: string;
    pageSize: number;
  }): string {
    return `${opts.start}~${opts.end}|${opts.column}|${opts.pageSize}|${opts.keyword}`;
  }

  /**
   * 单次 HTTP 查询（带超时 + 网络错误/5xx 重试；4xx 不重试）。
   * 返回 null 表示彻底失败（调用方据此显式降级，不返回种子）。
   */
  private async queryOnce(
    body: URLSearchParams,
    attempt: number,
  ): Promise<CninfoQueryResponse | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(QUERY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json, text/plain, */*',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Referer: 'https://www.cninfo.com.cn/new/index.jsp',
          Origin: 'https://www.cninfo.com.cn',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: body.toString(),
        signal: ctrl.signal,
        // 每次请求实时拉取；短缓存由本类内存层控制
        cache: 'no-store',
      } as RequestInit);
      if (!res.ok) {
        if (res.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
          await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
          return this.queryOnce(body, attempt + 1);
        }
        return null;
      }
      return (await res.json()) as CninfoQueryResponse;
    } catch (err) {
      // 网络错误 / 超时：指数退避重试
      if (attempt < RETRY_DELAYS_MS.length) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        return this.queryOnce(body, attempt + 1);
      }
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 拉取最近时间窗内的真实公告（按披露时间倒序）。 */
  async fetchLatest(opts: CninfoFetchOptions = {}): Promise<CninfoFetchResult> {
    const timeRange = resolveWindow(opts);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, opts.pageSize ?? 20));
    const keyword = (opts.keyword ?? '').trim();
    const column = (opts.column ?? '') as CninfoColumn;
    const key = this.cacheKey({ ...timeRange, keyword, column, pageSize });

    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return {
        items: cached.items,
        total: cached.total,
        origin: 'cache',
        timeRange: cached.timeRange,
        warnings: [],
      };
    }

    const body = new URLSearchParams();
    body.set('pageNum', '1');
    body.set('pageSize', String(pageSize));
    body.set('column', column);
    body.set('tabName', 'fulltext');
    body.set('plate', '');
    body.set('stock', '');
    body.set('searchkey', keyword);
    body.set('secid', '');
    body.set('category', '');
    body.set('trade', '');
    body.set('seDate', `${timeRange.start}~${timeRange.end}`);
    body.set('sortName', '');
    body.set('sortType', '');
    body.set('isHLtitle', 'true');
    body.set('clusterFlag', 'true');

    const data = await this.queryOnce(body, 0);
    if (!data) {
      throw new Error('巨潮资讯网公告查询失败（网络错误或服务不可用）');
    }
    const fetchedAt = new Date().toISOString();
    const rows = Array.isArray(data.announcements) ? data.announcements : [];
    const items = rows
      .map((r) => mapRow(r, fetchedAt))
      .filter((x): x is RawSourceItem => x !== null)
      // 接口本就按时间倒序，这里再排一次保险
      .sort((a, b) => Date.parse(b.disclosedAt) - Date.parse(a.disclosedAt));
    items.forEach((it) => this.byId.set(it.externalId, it));

    const entry: CacheEntry = { at: Date.now(), total: data.totalAnnouncement ?? items.length, timeRange, items };
    this.cache.set(key, entry);
    return {
      items,
      total: entry.total,
      origin: 'remote',
      timeRange,
      warnings:
        items.length === 0
          ? [`该时间窗（${timeRange.start} ~ ${timeRange.end}）内无匹配公告，请调整时间窗或更换更宽泛的关键词`]
          : [],
    };
  }

  /** 按 externalId 取最近拉取过的真实条目（用于接入主链路） */
  getCachedItem(externalId: string): RawSourceItem | undefined {
    return this.byId.get(externalId);
  }
}

// 单例（进程内缓存复用）；ADAPTER_VERSION 在映射结构变更时递增，避免 dev 热更后旧缓存条目缺字段
const ADAPTER_VERSION = 'v3';
declare global {
  // eslint-disable-next-line no-var
  var __cninfoLiveAdapter: CninfoLiveAdapter | undefined;
  // eslint-disable-next-line no-var
  var __cninfoLiveAdapterVersion: string | undefined;
}
export function getCninfoAdapter(): CninfoLiveAdapter {
  if (!globalThis.__cninfoLiveAdapter || globalThis.__cninfoLiveAdapterVersion !== ADAPTER_VERSION) {
    globalThis.__cninfoLiveAdapter = new CninfoLiveAdapter();
    globalThis.__cninfoLiveAdapterVersion = ADAPTER_VERSION;
  }
  return globalThis.__cninfoLiveAdapter;
}
