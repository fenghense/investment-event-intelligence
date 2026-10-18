import { IfindMcpClient } from './mcpClient';
import { extractRows } from './adapter';
import type {
  KlinePoint,
  MarketDataAdapter,
  MarketDataResult,
  MarketQuote,
} from '@/lib/adapters/fuyao/marketAdapter';

// ============================================================
// iFinD 股票行情适配器（ds-stock-mcp，真实 A 股行情）
// 工具实测（tools/list）：
//   get_stock_performance(query) 自然语言查日频历史行情，data.answer 为
//   Markdown 表格：|证券代码|证券简称|日期|最高价|收盘价|成交量|最低价|开盘价|涨跌幅|
//   日期 YYYYMMDD；成交量带中文单位（万/亿）；非交易日行仅收盘价（其余 \t，过滤）。
//   get_stock_summary(query) 标的概况/行业/财务摘要（data.answer 原文文本）。
// 凭证仅从 process.env 读取，禁止日志输出。
// ============================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 解析中文数量级数值：'2974.2445万'→29742450、'1.2亿'→120000000 */
function parseCnNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const text = raw.replace(/,/g, '').trim();
  const m = text.match(/^(-?\d+(?:\.\d+)?)(万|亿)?$/);
  if (!m) return null;
  const base = Number.parseFloat(m[1]);
  if (Number.isNaN(base)) return null;
  if (m[2] === '万') return Math.round(base * 1e4);
  if (m[2] === '亿') return Math.round(base * 1e8);
  return base;
}

function pickNum(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    for (const [rk, rv] of Object.entries(rec)) {
      if (rv != null && rk.replace(/[（(].*$/, '').trim() === k) {
        const n = Number.parseFloat(String(rv));
        if (!Number.isNaN(n)) return n;
      }
    }
  }
  return null;
}

function pickDate(rec: Record<string, unknown>): string | null {
  for (const [rk, rv] of Object.entries(rec)) {
    if (rv == null) continue;
    if (!rk.replace(/[（(].*$/, '').trim().match(/日期|时间|交易日/)) continue;
    const digits = String(rv).replace(/\D/g, '');
    if (digits.length === 8) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
    const m = String(rv).match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }
  return null;
}

const KLINE_TTL_MS = 30 * 60_000; // 行情 30min 缓存（日频）

interface CacheEntry {
  at: number;
  result: MarketDataResult;
}

export class IfindStockAdapter implements MarketDataAdapter {
  readonly name = 'ifind-stock';
  private client: IfindMcpClient | null = null;
  private cache = new Map<string, CacheEntry>();
  private profileCache = new Map<string, { at: number; text: string }>();

  isConfigured(): boolean {
    return Boolean(process.env.IFIND_STOCK_MCP_URL && process.env.IFIND_API_TOKEN);
  }

  private getClient(): IfindMcpClient {
    if (!this.client) {
      this.client = new IfindMcpClient(
        process.env.IFIND_STOCK_MCP_URL as string,
        process.env.IFIND_API_TOKEN as string,
      );
    }
    return this.client;
  }

  async getKline(code: string, start: string, end: string): Promise<MarketDataResult> {
    const cacheKey = `${code}|${start}|${end}`;
    const hit = this.cache.get(cacheKey);
    if (hit && Date.now() - hit.at < KLINE_TTL_MS) return { ...hit.result, origin: 'ifind' };
    if (!this.isConfigured()) throw new Error('IFIND_STOCK_MCP_URL / IFIND_API_TOKEN 未配置');

    const query = `${code} ${start}至${end}日行情，包含开盘价、最高价、最低价、收盘价、成交量、涨跌幅`;
    const client = this.getClient();
    const envelope = await client.callTool('get_stock_performance', { query });
    const rows = extractRows(envelope.data);
    const kline: KlinePoint[] = [];
    for (const rec of rows) {
      const date = pickDate(rec);
      const close = pickNum(rec, ['收盘价']);
      const open = pickNum(rec, ['开盘价']);
      // 非交易日行仅有收盘价（其余 \t），无开盘价则跳过
      if (!date || close == null || open == null) continue;
      const high = pickNum(rec, ['最高价']) ?? Math.max(open, close);
      const low = pickNum(rec, ['最低价']) ?? Math.min(open, close);
      const volRaw = (() => {
        for (const [rk, rv] of Object.entries(rec)) {
          if (rv != null && rk.replace(/[（(].*$/, '').trim().includes('成交量')) return String(rv);
        }
        return undefined;
      })();
      kline.push({
        date,
        open,
        close,
        high,
        low,
        volume: parseCnNumber(volRaw) ?? 0,
      });
    }
    kline.sort((a, b) => a.date.localeCompare(b.date));

    const last = kline[kline.length - 1];
    const prev = kline[kline.length - 2];
    const quote: MarketQuote | null = last
      ? {
          code,
          name: code,
          price: last.close,
          pctChange: prev ? round2(((last.close - prev.close) / prev.close) * 100) : 0,
          updatedAt: `${last.date}T15:00:00+08:00`,
        }
      : null;

    const warnings: string[] = [];
    if (kline.length === 0) {
      warnings.push('iFinD 行情查询返回空结果（非 A 股标的或时间窗外无交易日数据）');
    }
    const out: MarketDataResult = { origin: 'ifind', quote, kline, warnings };
    if (kline.length > 0) this.cache.set(cacheKey, { at: Date.now(), result: out });
    return out;
  }

  /**
   * 标的概况摘要（get_stock_summary 原文，含行业/板块/财务要点）。
   * 返回 null 表示查询失败或为空（上层降级为仅本地字段展示）。
   */
  async getProfile(code: string, name: string): Promise<string | null> {
    if (!this.isConfigured()) return null;
    const cacheKey = `profile|${code}`;
    const hit = this.profileCache.get(cacheKey);
    if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.text;
    try {
      const query = `${name}${code} 公司概况、所属申万行业、所属板块、总市值、主营业务`;
      const envelope = await this.getClient().callTool('get_stock_summary', { query });
      const text = this.extractText(envelope.data);
      if (!text) return null;
      this.profileCache.set(cacheKey, { at: Date.now(), text });
      return text;
    } catch {
      return null;
    }
  }

  /** 从 data 中提取概况文本：answer 为 Markdown 表格时原样保留，纯文本直接返回 */
  private extractText(data: unknown): string | null {
    if (data == null) return null;
    if (typeof data === 'string') return data.trim() || null;
    if (typeof data === 'object') {
      const rec = data as Record<string, unknown>;
      for (const key of ['answer', 'text', 'summary', 'content']) {
        const v = rec[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    }
    return null;
  }
}
