import type { RawSourceItem, SourceType } from '@/lib/domain/types';
import { SEED_RAW_ITEMS, SEED_TARGETS } from '@/lib/server/seed';
import type { SourceAdapter } from '@/lib/adapters/sourceAdapter';
import { registerAdapter } from '@/lib/adapters/sourceAdapter';
import { IfindMcpClient } from './mcpClient';

// ============================================================
// iFinD 真实数据源适配器（IfindSourceAdapter）
// 降级链：iFinD 实时 → 命中缓存（新鲜/过期）→ 本地演示语料 → 明确提示
// 额度保护：进程内缓存（公告 24h / 新闻 12h）+ 客户端 ≥1s 限流 + 指数退避重试 + 调用计数
// ============================================================

const DEFAULT_MCP_URL = 'https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-mcp';
const NOTICE_TTL_MS = 24 * 60 * 60 * 1000; // 公告缓存 24h
const NEWS_TTL_MS = 12 * 60 * 60 * 1000; // 新闻缓存 12h
const STALE_FACTOR = 10; // 过期缓存宽限：TTL 的 10 倍内仍可作降级兜底
const DEFAULT_SIZE = 10;
const DEFAULT_WINDOW_DAYS = 180;

export type DataOrigin = 'remote' | 'cache' | 'fallback';

export interface SourceFetchWarning {
  stage: 'notice' | 'news' | 'trending' | 'global';
  origin: DataOrigin;
  message: string;
}

export interface IfindFetchResult {
  items: RawSourceItem[];
  /** 最终数据来源（任一工具实时成功为 remote；全部缓存为 cache；否则 fallback） */
  origin: DataOrigin;
  warnings: SourceFetchWarning[];
  quota: { mcpCalls: number };
  sources: Array<{ tool: string; origin: DataOrigin; count: number }>;
}

// ------------------------------------------------------------
// search_trending_news 严格契约（iFinD MCP 实测枚举，非法值会 HTTP 400）
// ------------------------------------------------------------
/** time_scope 仅允许这三个枚举值，默认 24小时 */
export const TRENDING_TIME_SCOPES = ['6小时', '24小时', '近一周'] as const;
export type TrendingTimeScope = (typeof TRENDING_TIME_SCOPES)[number];
/** sensitive 情感枚举 */
export const TRENDING_SENSITIVES = ['正面', '负面', '中性', '全部'] as const;
export type TrendingSensitive = (typeof TRENDING_SENSITIVES)[number];
/** industry_name 仅允许 30 个申万一级行业 */
export const SW_INDUSTRY_NAMES = [
  '交通运输', '传媒', '公用事业', '农林牧渔', '医药生物', '商贸零售', '国防军工', '基础化工',
  '家用电器', '建筑材料', '建筑装饰', '房地产', '有色金属', '机械设备', '汽车', '煤炭', '环保',
  '电力设备', '电子', '石油石化', '社会服务', '纺织服饰', '美容护理', '计算机', '轻工制造',
  '通信', '钢铁', '银行', '非银金融', '食品饮料',
] as const;
/** 热门事件 size 上限 */
export const TRENDING_MAX_SIZE = 20;
/** iFinD 各工具 size 统一上限（超出会被服务端拒绝/截断） */
export const IFIND_MAX_SIZE = 20;

/** /api/live 的 days 参数 → time_scope 枚举映射：1→24小时，7/30→近一周（无更长枚举） */
export function daysToTrendingScope(days: 1 | 7 | 30): TrendingTimeScope {
  if (days === 1) return '24小时';
  return '近一周';
}

/** 行业名白名单校验：仅申万 30 个一级行业原样透传，其余丢弃（防止 400） */
export function normalizeSwIndustry(input?: string): string | undefined {
  if (!input) return undefined;
  const trimmed = input.trim();
  return (SW_INDUSTRY_NAMES as readonly string[]).includes(trimmed) ? trimmed : undefined;
}

interface CacheEntry {
  items: RawSourceItem[];
  cachedAt: number;
  ttlMs: number;
}

class IfindCache {
  private readonly map = new Map<string, CacheEntry>();

  get(key: string): { entry: CacheEntry; fresh: boolean } | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    const age = Date.now() - entry.cachedAt;
    if (age > entry.ttlMs * STALE_FACTOR) {
      this.map.delete(key);
      return null;
    }
    return { entry, fresh: age <= entry.ttlMs };
  }

  set(key: string, items: RawSourceItem[], ttlMs: number): void {
    this.map.set(key, { items, cachedAt: Date.now(), ttlMs });
  }
}

// ------------------------------------------------------------
// 单例客户端 / 缓存（globalThis 防 HMR 重建）
// ------------------------------------------------------------
const GLOBAL_KEY = '__IFIND_MCP_RUNTIME__';

interface IfindRuntime {
  client: IfindMcpClient;
  cache: IfindCache;
}

function getRuntime(): IfindRuntime {
  const g = globalThis as unknown as Record<string, IfindRuntime | undefined>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      client: new IfindMcpClient(process.env.IFIND_MCP_URL ?? DEFAULT_MCP_URL, process.env.IFIND_API_TOKEN ?? ''),
      cache: new IfindCache(),
    };
  }
  return g[GLOBAL_KEY];
}

/** 适配器是否具备实时调用条件（不泄露凭证） */
export function ifindConfigured(): boolean {
  return getRuntime().client.isConfigured();
}

/** iFinD MCP 调用用量 */
export function getIfindQuota(): { configured: boolean; mcpCalls: number } {
  const { client } = getRuntime();
  return { configured: client.isConfigured(), mcpCalls: client.getQuota().calls };
}

// ------------------------------------------------------------
// 字段映射：iFinD 片段记录 → RawSourceItem
// ------------------------------------------------------------
function pick(record: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = record[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const lowered = keys.map((k) => k.toLowerCase());
  for (const [k, v] of Object.entries(record)) {
    if (lowered.includes(k.toLowerCase()) && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** 兼容 YYYY-MM-DD / YYYY/M/D / YYYY年M月D日 / 完整时间戳；纯日期按 18:00 +08:00（收盘后披露惯例） */
function toDisclosedAt(rawDate: string): string {
  if (!rawDate) return new Date().toISOString();
  const normalized = rawDate.trim().replace(/年|月/g, '-').replace(/日/g, '').replace(/\//g, '-');
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)) return `${normalized}T18:00:00+08:00`;
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
}

function detectBulletinType(title: string): string {
  if (/更正|勘误/.test(title)) return '更正公告';
  if (/澄清|否认|不属实/.test(title)) return '澄清公告';
  if (/进展/.test(title)) return '进展公告';
  if (/结果|届满|到期|终止/.test(title)) return '实施结果公告';
  if (/增持|减持|质押|收购|转让|认购|定增|非公开发行/.test(title)) return '重大事项公告';
  return '公告';
}

/** 仅保留真正的对象行 */
function toRecordArray(data: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(data)) return [];
  return data.filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null);
}

/**
 * 解析 Markdown 表格为对象数组。
 * 兼容：
 *  | 公告标题 | 日期 | ... |
 *  |---|---|
 *  | 光迅科技... | 2025-... |
 * 以及无外框管道的表格。
 */
function parseMarkdownTable(text: string): Array<Record<string, unknown>> {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  // 找到表头行（至少含一个 | 且能拆出 2 列以上）
  const headerIdx = lines.findIndex((l) => l.includes('|') && splitRow(l).length >= 2);
  if (headerIdx < 0) return [];
  const headers = splitRow(lines[headerIdx]).map((h) => h.trim());
  const rows: Array<Record<string, unknown>> = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.includes('|')) {
      // 表格结束（进入正文段落）
      if (rows.length > 0) break;
      continue;
    }
    const cells = splitRow(line);
    // 跳过分隔行 |---|---|
    if (cells.every((c) => /^:?-{2,}:?$/.test(c.trim()))) continue;
    if (cells.length !== headers.length) continue;
    const rec: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      const v = cells[idx]?.trim();
      if (v) rec[h] = v;
    });
    if (Object.keys(rec).length > 0) rows.push(rec);
  }
  return rows;
}

function splitRow(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|');
}

/**
 * 健壮提取 iFinD 结果行。覆盖真实线上全部已观测形态：
 *  1) data 直接是对象数组
 *  2) data 是 JSON 字符串（双重编码：数组，或 {"data":[...]} 信封）
 *  3) data 是对象，真实数组藏在 data.list/records/rows/result/items 中
 *  4) data 是 '# 查询结果\n|...|...|' Markdown 表格 / 纯文本
 * 解析失败或确为空时返回 []（由上层如实返回空结果，不伪造）。
 */
export function extractRows(data: unknown): Array<Record<string, unknown>> {
  if (data == null) return [];

  // 1) 直接是数组
  if (Array.isArray(data)) return toRecordArray(data);

  if (typeof data === 'string') {
    const text = data.trim();
    if (!text) return [];
    // 2) 双重编码 JSON 字符串
    if (text.startsWith('[') || text.startsWith('{')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        return extractRows(parsed);
      } catch {
        // 落入 Markdown 解析
      }
    }
    // 4) Markdown 表格
    if (text.includes('|')) {
      const rows = parseMarkdownTable(text);
      if (rows.length > 0) return rows;
    }
    return [];
  }

  if (typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    // 3) 常见承载字段（answer：stock-mcp 系列工具的行情/概况 Markdown 表格载体）
    for (const key of ['data', 'list', 'records', 'rows', 'result', 'items', 'notices', 'news', 'answer']) {
      if (rec[key] != null) {
        const rows = extractRows(rec[key]);
        if (rows.length > 0) return rows;
      }
    }
    // 单个对象本身就是一行（如 {公告标题, 日期}）
    if (Object.keys(rec).length > 0) return [rec];
  }
  return [];
}

function mapNotice(record: Record<string, unknown>, fetchedAt: string): RawSourceItem {
  const title = pick(record, ['公告标题', '公告名称', '标题', 'title']);
  const content = pick(record, ['公告片段内容', '片段内容', '内容摘要', '摘要', 'content', 'snippet']);
  const date = pick(record, ['日期', '披露日期', '公告日期', '发布日期', 'date', 'time']);
  const no = pick(record, ['公告编号', '编号', 'announcementNo', 'announcement_no']);
  const url = (pick(record, ['URL', 'url', 'Url', '链接', 'link', '公告链接', '原文链接']) ?? pickLoose(record, ['URL', 'url', '链接', 'link', '公告链接'])) || undefined;
  const disclosedAt = toDisclosedAt(date);
  const externalId = `IFIND-NOTICE-${hashString(`${title}|${date}`)}`;
  return {
    externalId,
    sourceType: 'announcement' as SourceType,
    sourceName: '同花顺iFinD·公告检索',
    title: title || '（iFinD 未命名公告）',
    content: content || title,
    ...(url ? { url } : {}),
    ...(no ? { announcementNo: no } : {}),
    disclosedAt,
    fetchedAt,
    meta: {
      bulletinType: detectBulletinType(title),
      evidenceType: 'fact',
      officialConfirm: true,
      sourceHitRate: 0.95,
    },
    rawSnapshot: record,
    origin: 'remote',
  };
}

/**
 * 宽松键提取（兜底扫描）：键名 trim + 大小写不敏感 + 双向包含匹配。
 * iFinD 中文键存在「资讯标题」/「URL」等与预设列表大小写或用词不一致的情况，
 * 精确 pick 未命中时扫描一遍原始键，保证真实字段不漏取。
 */
function pickLoose(record: Record<string, unknown>, keys: string[]): string | undefined {
  const lowered = keys.map((k) => k.toLowerCase());
  for (const [k, v] of Object.entries(record)) {
    if (typeof v !== 'string' || !v.trim()) continue;
    const kk = k.trim().toLowerCase();
    if (lowered.some((key) => kk === key || kk.includes(key) || key.includes(kk))) return v.trim();
  }
  return undefined;
}

const NEWS_TITLE_KEYS = ['资讯标题', '新闻标题', '标题', 'title', 'headline'];
const NEWS_CONTENT_KEYS = ['资讯内容', '新闻片段内容', '片段内容', '内容', '摘要', 'content', 'snippet', 'summary'];
const NEWS_URL_KEYS = ['URL', 'url', 'Url', '资讯链接', '原文链接', '链接', 'link', 'Link'];

function mapNews(record: Record<string, unknown>, fetchedAt: string): RawSourceItem {
  // 中文键优先（实测结构：资讯标题/资讯内容/URL），英文键兼容，最后宽松扫描兜底
  const content =
    pick(record, NEWS_CONTENT_KEYS) ?? pickLoose(record, NEWS_CONTENT_KEYS) ?? '';
  const titleRaw = pick(record, NEWS_TITLE_KEYS) ?? pickLoose(record, NEWS_TITLE_KEYS);
  // 标题缺失时以内容前 28 字生成，保证 title 非空且永不出现占位符
  const title = titleRaw || (content.length > 30 ? `${content.slice(0, 28)}…` : content);
  const date = pick(record, ['日期', '发布时间', '发布日期', '时间', 'date', 'time', 'datetime', 'publishTime', 'publish_time']);
  const media = pick(record, ['来源', '媒体', '媒体来源', 'source', 'src', 'media']);
  const url = (pick(record, NEWS_URL_KEYS) ?? pickLoose(record, NEWS_URL_KEYS)) || undefined;
  const disclosedAt = toDisclosedAt(date);
  const externalId = `IFIND-NEWS-${hashString(`${title}|${date}|${content.slice(0, 24)}`)}`;
  return {
    externalId,
    sourceType: 'media' as SourceType,
    sourceName: media ? `同花顺iFinD·${media}` : '同花顺iFinD·财经资讯',
    title: title || '（iFinD 资讯片段）',
    content: content || title,
    ...(url ? { url } : {}),
    disclosedAt,
    fetchedAt,
    meta: { sourceHitRate: 0.75 },
    rawSnapshot: record,
    origin: 'remote',
  };
}

// ------------------------------------------------------------
// 本地降级：复用演示语料（打 fallback 标记，绝不冒充实时数据）
// ------------------------------------------------------------
function fallbackFromSeed(query: string, timeStart: string, timeEnd: string): RawSourceItem[] {
  const start = Date.parse(timeStart);
  const end = Date.parse(timeEnd);
  const q = query.trim();
  const target = SEED_TARGETS.find((t) => t.code === q || t.name === q);
  const names = target ? [target.name, ...(target.aliases ?? [])] : q ? [q] : [];
  return SEED_RAW_ITEMS.filter((r) => {
    const t = Date.parse(r.disclosedAt);
    const inWindow = Number.isNaN(start) || Number.isNaN(end) || (t >= start && t <= end + 86_400_000);
    const hit = !q || names.some((n) => `${r.title}${r.content}`.includes(n));
    return inWindow && hit;
  }).map((r) => ({
    ...r,
    externalId: `FALLBACK-${r.externalId}`,
    origin: 'fallback' as const,
    meta: { ...r.meta, bulletinType: r.meta.bulletinType ? `${r.meta.bulletinType}（演示降级数据）` : '演示降级数据' },
  }));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// 适配器主体
// ------------------------------------------------------------
export class IfindSourceAdapter implements SourceAdapter {
  readonly name = 'ifind';
  private readonly cache: IfindCache;

  constructor() {
    this.cache = getRuntime().cache;
  }

  private get client(): IfindMcpClient {
    return getRuntime().client;
  }

  /**
   * 按标的/关键词 + 时间窗拉取公告与新闻，执行完整降级链。
   * 同一标的+时间窗命中新鲜缓存时不产生 MCP 调用（额度保护）。
   */
  async fetchByTargetRange(
    query: string,
    timeStart: string,
    timeEnd: string,
    size = DEFAULT_SIZE,
  ): Promise<IfindFetchResult> {
    const warnings: SourceFetchWarning[] = [];
    const sources: IfindFetchResult['sources'] = [];
    const items: RawSourceItem[] = [];
    let sawRemote = false;
    let sawCache = false;

    const jobs = [
      { stage: 'notice' as const, tool: 'search_notice', ttl: NOTICE_TTL_MS, mapper: mapNotice },
      { stage: 'news' as const, tool: 'search_news', ttl: NEWS_TTL_MS, mapper: mapNews },
    ];

    for (const job of jobs) {
      const cacheKey = `${job.tool}|${query}|${timeStart}|${timeEnd}|${size}`;
      const cached = this.cache.get(cacheKey);
      if (cached?.fresh) {
        // 命中新鲜缓存：不调用 MCP
        items.push(...cached.entry.items);
        sources.push({ tool: job.tool, origin: 'cache', count: cached.entry.items.length });
        sawCache = true;
        continue;
      }

      try {
        if (!this.client.isConfigured()) {
          throw new Error('IFIND_MCP_URL / IFIND_API_TOKEN 未配置');
        }
        const envelope = await this.client.callTool<unknown>(job.tool, {
          query,
          time_start: timeStart,
          time_end: timeEnd,
          size,
        });
        const fetchedAt = new Date().toISOString();
        // 健壮解析：对象数组 / 双重编码 JSON / Markdown 表格 / 嵌套字段
        const mapped = extractRows(envelope.data).map((r) => job.mapper(r, fetchedAt));
        if (mapped.length > 0) {
          // 仅缓存非空结果，避免“查询词无结果”被缓存 24h 形成毒缓存
          this.cache.set(cacheKey, mapped, job.ttl);
        }
        items.push(...mapped);
        sources.push({ tool: job.tool, origin: 'remote', count: mapped.length });
        sawRemote = true;
        if (mapped.length === 0) {
          // 远程调用成功但该时间窗内确无匹配：如实返回空，禁止静默回退种子/演示数据
          warnings.push({
            stage: job.stage,
            origin: 'remote',
            message: `${job.tool === 'search_notice' ? '公告' : '新闻'}：iFinD 实时查询成功，但该时间窗（${timeStart} ~ ${timeEnd}）内无匹配片段，请调整时间窗或更换更宽泛的关键词`,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // 降级 1：过期但仍在宽限期内的缓存
        if (cached) {
          items.push(...cached.entry.items);
          sources.push({ tool: job.tool, origin: 'cache', count: cached.entry.items.length });
          sawCache = true;
          warnings.push({
            stage: job.stage,
            origin: 'cache',
            message: `iFinD ${job.tool} 实时调用失败，已使用过期缓存：${msg}`,
          });
          continue;
        }
        // 降级 2：本地演示语料
        const fb = fallbackFromSeed(query, timeStart, timeEnd).filter((r) =>
          job.stage === 'notice' ? r.sourceType === 'announcement' || r.sourceType === 'exchange' : r.sourceType === 'media' || r.sourceType === 'research',
        );
        items.push(...fb);
        sources.push({ tool: job.tool, origin: 'fallback', count: fb.length });
        warnings.push({
          stage: job.stage,
          origin: 'fallback',
          message: fb.length
            ? `iFinD ${job.tool} 暂不可用（${msg}），已降级为本地演示语料`
            : `iFinD ${job.tool} 暂不可用（${msg}），且本地无匹配演示数据：数据服务暂不可用`,
        });
      }
    }

    const origin: DataOrigin = sawRemote ? 'remote' : sawCache ? 'cache' : 'fallback';
    if (origin === 'fallback' && items.length === 0) {
      warnings.push({ stage: 'global', origin: 'fallback', message: '数据服务暂不可用，且无任何可展示的降级数据' });
    }
    return { items, origin, warnings, quota: { mcpCalls: this.client.getQuota().calls }, sources };
  }

  /** SourceAdapter 接口：按标的代码拉取（默认近 180 天） */
  async fetchByTarget(code: string): Promise<RawSourceItem[]> {
    const target = SEED_TARGETS.find((t) => t.code === code);
    const query = target?.name ?? code;
    const end = new Date();
    const start = new Date(end.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
    const result = await this.fetchByTargetRange(query, formatDate(start), formatDate(end));
    return result.items;
  }

  /**
   * 【严格实时】按关键词 + 时间窗拉取新闻片段。
   * 与 fetchByTargetRange 不同：不做任何种子/演示回退。
   * - 未配置 / 调用失败 → 抛错（由汇聚接口统一显式降级）
   * - 调用成功但无结果 → 返回空数组（origin:'remote'），不写毒缓存
   * 允许命中新鲜/过期缓存（origin:'cache'），那是真实数据的缓存。
   */
  async fetchLiveNews(
    query: string,
    timeStart: string,
    timeEnd: string,
    size = DEFAULT_SIZE,
  ): Promise<{ items: RawSourceItem[]; origin: DataOrigin }> {
    const safeSize = Math.max(1, Math.min(IFIND_MAX_SIZE, size));
    const cacheKey = `search_news|${query}|${timeStart}|${timeEnd}|${safeSize}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.fresh) return { items: cached.entry.items, origin: 'cache' };

    if (!this.client.isConfigured()) {
      throw new Error('IFIND_MCP_URL / IFIND_API_TOKEN 未配置');
    }
    const envelope = await this.client.callTool<unknown>('search_news', {
      query,
      time_start: timeStart,
      time_end: timeEnd,
      size: safeSize,
    });
    const fetchedAt = new Date().toISOString();
    const items = extractRows(envelope.data)
      .map((r) => mapNews(r, fetchedAt))
      .filter((it) => it.content.trim().length > 0);
    if (items.length > 0) this.cache.set(cacheKey, items, NEWS_TTL_MS);
    return { items, origin: 'remote' };
  }

  /**
   * 【严格实时】热门事件 / 行业动态（search_trending_news）。
   * 严格按 iFinD MCP 契约：time_scope 仅 ['6小时','24小时','近一周']、sensitive 枚举、
   * industry_name 为 30 个申万行业、size 必填且 ≤20；keyword 可选（简洁通用）。无种子回退。
   */
  async fetchTrending(
    timeScope: TrendingTimeScope = '24小时',
    options?: { industry?: string; size?: number; keyword?: string; sensitive?: TrendingSensitive },
  ): Promise<{ items: RawSourceItem[]; origin: DataOrigin }> {
    const industry = normalizeSwIndustry(options?.industry);
    const sensitive = options?.sensitive && TRENDING_SENSITIVES.includes(options.sensitive) ? options.sensitive : '全部';
    const keyword = options?.keyword?.trim() || undefined;
    const size = Math.max(1, Math.min(TRENDING_MAX_SIZE, options?.size ?? TRENDING_MAX_SIZE));
    const cacheKey = `trending|${timeScope}|${industry ?? 'all'}|${sensitive}|${keyword ?? ''}|${size}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.fresh) return { items: cached.entry.items, origin: 'cache' };

    if (!this.client.isConfigured()) {
      throw new Error('IFIND_MCP_URL / IFIND_API_TOKEN 未配置');
    }
    const args: Record<string, unknown> = { time_scope: timeScope, size, sensitive };
    if (industry) args.industry_name = industry;
    if (keyword) args.keyword = keyword;
    const envelope = await this.client.callTool<unknown>('search_trending_news', args);
    const fetchedAt = new Date().toISOString();
    const items = extractRows(envelope.data)
      .map((r) => mapNews(r, fetchedAt))
      .filter((it) => it.content.trim().length > 0);
    if (items.length > 0) this.cache.set(cacheKey, items, NEWS_TTL_MS);
    return { items, origin: 'remote' };
  }

  /** SourceAdapter 接口：增量拉取（热门事件驱动资讯） */
  async fetchLatest(since?: string): Promise<RawSourceItem[]> {
    const cacheKey = `trending|${since ?? 'initial'}`;
    const cached = this.cache.get(cacheKey);
    if (cached?.fresh) return cached.entry.items;
    const fetchedAt = new Date().toISOString();
    try {
      if (!this.client.isConfigured()) throw new Error('IFIND_MCP_URL / IFIND_API_TOKEN 未配置');
      const envelope = await this.client.callTool<unknown>('search_trending_news', {
        time_scope: '24小时',
        size: TRENDING_MAX_SIZE,
        sensitive: '全部',
      });
      const mapped = extractRows(envelope.data).map((r) => mapNews(r, fetchedAt));
      this.cache.set(cacheKey, mapped, NEWS_TTL_MS);
      return mapped;
    } catch {
      // 降级：本地语料中 since 之后的条目，打 fallback 标记
      const sinceMs = since ? Date.parse(since) : 0;
      return SEED_RAW_ITEMS.filter((r) => !since || Date.parse(r.disclosedAt) >= sinceMs).map((r) => ({
        ...r,
        externalId: `FALLBACK-${r.externalId}`,
        origin: 'fallback' as const,
      }));
    }
  }
}

// 注册到数据源 registry（mock 仍由 store 注册，二者并存）
registerAdapter(new IfindSourceAdapter());
