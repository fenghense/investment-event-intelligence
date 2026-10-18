import type { KlinePoint, MarketDataAdapter, MarketDataResult, MarketQuote } from './marketAdapter';

// Contract: https://fuyao.aicubes.cn/docs/api-reference/prices/
// API keys remain server-side. HTTP 200 alone is not success: code must be 0.
type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as RecordValue : null;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function fuyaoStockCode(code: string): string {
  const normalized = code.trim().toUpperCase();
  const match = normalized.match(/^([03648]\d{5}|92\d{4})(?:\.(SH|SZ|BJ))?$/);
  if (!match) throw new Error('扶摇行情仅支持有效的 A 股证券代码');
  const ticker = match[1];
  const exchange = ticker.startsWith('6') ? 'SH' : /^[03]/.test(ticker) ? 'SZ' : 'BJ';
  if (match[2] && match[2] !== exchange) throw new Error('证券代码与交易所后缀不匹配');
  return `${ticker}.${exchange}`;
}

function dateMs(date: string, end: boolean): number {
  const utc = Date.parse(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(utc)
      || new Date(utc).toISOString().slice(0, 10) !== date) {
    throw new Error('行情日期格式应为有效的 YYYY-MM-DD');
  }
  return Date.parse(`${date}T${end ? '23:59:59.999' : '00:00:00.000'}+08:00`);
}

function shanghaiDate(ms: number): string {
  return new Date(ms + 8 * 60 * 60_000).toISOString().slice(0, 10);
}

interface Options {
  baseUrl?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class FuyaoHttpAdapter implements MarketDataAdapter {
  readonly name = 'fuyao-http';
  private readonly cache = new Map<string, { at: number; result: MarketDataResult }>();
  private readonly pending = new Map<string, Promise<MarketDataResult>>();

  constructor(private readonly options: Options = {}) {}

  private config() {
    return {
      base: (this.options.baseUrl ?? process.env.FUYAO_API_URL ?? '').trim(),
      token: (this.options.apiToken ?? process.env.FUYAO_API_TOKEN ?? '').trim(),
    };
  }

  isConfigured(): boolean {
    const { base, token } = this.config();
    return Boolean(base && token);
  }

  private async request(path: string, params: Record<string, string>): Promise<RecordValue> {
    const { base, token } = this.config();
    if (!base || !token) throw new Error('FUYAO_API_URL / FUYAO_API_TOKEN 未配置');
    const origin = new URL(base);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search
        || origin.hash || origin.pathname !== '/') {
      throw new Error('FUYAO_API_URL 应填写 HTTPS 平台根地址，不含 /admin 或 /api');
    }
    const url = new URL(path, origin);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    try {
      const response = await (this.options.fetchImpl ?? fetch)(url, {
        headers: { 'X-api-key': token, Accept: 'application/json' },
        cache: 'no-store', redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) throw new Error(`扶摇接口返回 HTTP ${response.status}`);
      const envelope = record(await response.json());
      if (!envelope || !finite(envelope.code)) throw new Error('扶摇接口响应格式无效');
      if (envelope.code !== 0) {
        const reason: Record<number, string> = {
          2001: 'API Key 缺失或无效', 2003: 'API Key 无权访问此接口', 4001: '请求触发限流，请稍后重试',
        };
        throw new Error(`扶摇接口业务错误 ${envelope.code}：${reason[envelope.code] ?? '请求未成功'}`);
      }
      const data = record(envelope.data);
      if (!data || !Array.isArray(data.item)) throw new Error('扶摇接口缺少 data.item 数组');
      return data;
    } catch (error) {
      if (controller.signal.aborted) throw new Error('扶摇接口请求超时，请稍后重试');
      // Do not expose arbitrary response bodies or credentials in public API errors.
      if (error instanceof Error && error.message.startsWith('扶摇接口')) throw error;
      throw new Error('扶摇接口网络或 JSON 响应异常');
    } finally {
      clearTimeout(timer);
    }
  }

  async getKline(code: string, start: string, end: string): Promise<MarketDataResult> {
    const thscode = fuyaoStockCode(code);
    const startMs = dateMs(start, false);
    const endMs = dateMs(end, true);
    if (endMs < startMs || endMs - startMs > 3653 * 24 * 60 * 60_000) {
      throw new Error('行情日期范围无效或超过 10 年');
    }
    if (!this.isConfigured()) throw new Error('FUYAO_API_URL / FUYAO_API_TOKEN 未配置');
    const key = `${thscode}|${start}|${end}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.result;
    const existing = this.pending.get(key);
    if (existing) return existing;
    const query = this.load(thscode, start, end, startMs, endMs).then(result => {
      if (result.warnings.length === 0 && (result.quote || result.kline.length)) {
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value as string);
        this.cache.set(key, { at: Date.now(), result });
      }
      return result;
    }).finally(() => this.pending.delete(key));
    this.pending.set(key, query);
    return query;
  }

  private async load(thscode: string, start: string, end: string, startMs: number, endMs: number): Promise<MarketDataResult> {
    const [history, snapshot] = await Promise.allSettled([
      this.request('/api/a-share/prices/historical', {
        thscode, interval: '1d', start: String(startMs), end: String(endMs), adjust: 'forward',
      }),
      this.request('/api/a-share/prices/snapshot', { thscodes: thscode }),
    ]);
    const warnings: string[] = [];
    const failure = (value: unknown): string => value instanceof Error ? value.message : '扶摇接口调用失败';
    if (history.status === 'rejected' && snapshot.status === 'rejected') {
      throw new Error(failure(history.reason));
    }
    const bars = new Map<string, KlinePoint>();
    if (history.status === 'fulfilled') {
      let invalid = 0;
      for (const value of history.value.item as unknown[]) {
        const row = record(value);
        if (!row || !finite(row.date_ms) || !Number.isFinite(new Date(row.date_ms).getTime())
            || !finite(row.open_price) || !finite(row.high_price) || !finite(row.low_price)
            || !finite(row.close_price) || !finite(row.volume)
            || Math.min(row.open_price, row.high_price, row.low_price, row.close_price) <= 0 || row.volume < 0
            || row.high_price < Math.max(row.open_price, row.close_price)
            || row.low_price > Math.min(row.open_price, row.close_price)) {
          invalid += 1;
          continue;
        }
        const date = shanghaiDate(row.date_ms);
        if (date < start || date > end) continue;
        bars.set(date, { date, open: row.open_price, high: row.high_price, low: row.low_price,
          close: row.close_price, volume: row.volume / 100 }); // API 股 → domain 手
      }
      if (invalid) warnings.push(`历史行情中 ${invalid} 条字段不完整的记录已忽略`);
      if (!bars.size) warnings.push('扶摇历史行情在所选时间范围内无有效交易数据');
    } else warnings.push(`历史行情不可用：${failure(history.reason)}`);

    let quote: MarketQuote | null = null;
    if (snapshot.status === 'fulfilled') {
      const row = (snapshot.value.item as unknown[]).map(record).find(item => item?.thscode === thscode);
      const timestamp = snapshot.value.timestamp;
      if (row && finite(row.last_price) && row.last_price > 0 && finite(row.price_change_ratio_pct)
          && finite(timestamp) && Number.isFinite(new Date(timestamp).getTime())) {
        quote = { code: thscode.split('.')[0], name: thscode.split('.')[0], price: row.last_price,
          pctChange: row.price_change_ratio_pct, updatedAt: new Date(timestamp).toISOString() };
      } else warnings.push('扶摇行情快照暂无有效报价或更新时间');
    } else warnings.push(`行情快照不可用：${failure(snapshot.reason)}`);
    return { origin: 'fuyao', quote, kline: [...bars.values()].sort((a, b) => a.date.localeCompare(b.date)), warnings };
  }
}
