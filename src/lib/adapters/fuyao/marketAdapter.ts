import type { EventStatus } from '@/lib/domain/types';
// stockAdapter 对本文件仅为 type-only 引用，runtime 单向依赖，无循环
import { IfindStockAdapter } from '@/lib/adapters/ifind/stockAdapter';
import { FuyaoHttpAdapter } from './httpAdapter';
export { FuyaoHttpAdapter } from './httpAdapter';

// ============================================================
// 扶摇行情数据适配器
// 真实接入：FUYAO_API_URL / FUYAO_API_TOKEN（环境变量，禁止硬编码）
// 未配置时显式降级为内置演示行情（origin:'fallback'，确定性伪随机生成，
// 仅用于演示影响分析视图，绝不冒充真实行情）
// ============================================================

export interface KlinePoint {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  volume: number; // 手
}

export interface MarketQuote {
  code: string;
  name: string;
  price: number;
  pctChange: number;
  updatedAt: string;
}

export type MarketOrigin = 'fuyao' | 'ifind' | 'fallback';

export interface MarketDataResult {
  origin: MarketOrigin;
  quote: MarketQuote | null;
  kline: KlinePoint[];
  warnings: string[];
}

export interface MarketDataAdapter {
  readonly name: string;
  isConfigured(): boolean;
  getKline(code: string, start: string, end: string): Promise<MarketDataResult>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- 演示降级行情（确定性生成，注入事件窗口异动） ----------
export class MockMarketAdapter implements MarketDataAdapter {
  readonly name = 'fuyao-mock';

  isConfigured(): boolean {
    return true;
  }

  private hash(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  async getKline(code: string, start: string, end: string): Promise<MarketDataResult> {
    return this.generate(code, start, end, []);
  }

  /**
   * 确定性生成演示 K 线；eventWindows 用于在事件窗口注入量升价动，
   * 让影响分析视图有可讲的故事。数据本身明确标记 fallback。
   */
  generate(
    code: string,
    start: string,
    end: string,
    eventWindows: Array<{ date: string; sentiment: 1 | -1 | 0 }>,
  ): MarketDataResult {
    const basePrice = 8 + (this.hash(`P:${code}`) % 4000) / 100; // 8 ~ 48 元
    const baseVol = 20_000 + (this.hash(`V:${code}`) % 80_000);
    const points: KlinePoint[] = [];
    const cursor = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    let prevClose = basePrice;
    while (cursor <= endDate) {
      const day = cursor.getDay();
      if (day !== 0 && day !== 6) {
        const ds = toDateStr(cursor);
        const seed = this.hash(`${code}:${ds}`);
        let pct = ((seed % 1000) / 1000 - 0.5) * 0.05; // ±2.5% 随机游走
        let volBoost = 1;
        const hit = eventWindows.find((w) => {
          const delta = Math.abs(new Date(`${w.date}T00:00:00`).getTime() - cursor.getTime()) / 86_400_000;
          return delta <= 1;
        });
        if (hit) {
          pct = hit.sentiment * (0.025 + (seed % 300) / 10_000); // ±2.5%~5.5%
          volBoost = 2.2 + (seed % 150) / 100; // 放量 2.2~3.7 倍
        }
        const close = round2(prevClose * (1 + pct));
        const open = round2(prevClose * (1 + pct * 0.3));
        points.push({
          date: ds,
          open,
          close,
          high: round2(Math.max(open, close) * 1.012),
          low: round2(Math.min(open, close) * 0.988),
          volume: Math.round(baseVol * volBoost * (0.7 + (seed % 60) / 100)),
        });
        prevClose = close;
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    const pctChange = last && prev ? round2(((last.close - prev.close) / prev.close) * 100) : 0;
    return {
      origin: 'fallback',
      quote: last
        ? { code, name: code, price: last.close, pctChange, updatedAt: `${last.date}T15:00:00+08:00` }
        : null,
      kline: points,
      warnings: ['扶摇行情服务未配置（FUYAO_API_URL），当前为内置演示行情，仅用于影响分析视图演示'],
    };
  }
}

const globalForMarket = globalThis as unknown as {
  __marketAdapter?: { version: number; adapter: MarketDataAdapter };
};

// 版本戳：适配器选择链结构变更时递增（防 dev 热更后旧单例缺少新源）
const MARKET_ADAPTER_VERSION = 3;

export function getMarketAdapter(): MarketDataAdapter {
  const cached = globalForMarket.__marketAdapter;
  if (cached && cached.version === MARKET_ADAPTER_VERSION) return cached.adapter;
  // 选择链：扶摇 HTTP（FUYAO_API_URL）→ iFinD 股票行情（IFIND_STOCK_MCP_URL）→ 演示降级
  const fuyao = new FuyaoHttpAdapter();
  const ifind = new IfindStockAdapter();
  const adapter: MarketDataAdapter = fuyao.isConfigured()
    ? fuyao
    : ifind.isConfigured()
      ? ifind
      : new MockMarketAdapter();
  globalForMarket.__marketAdapter = { version: MARKET_ADAPTER_VERSION, adapter };
  return adapter;
}

export function marketOrigin(adapter: MarketDataAdapter): MarketOrigin {
  if (adapter.name === 'fuyao-http' && adapter.isConfigured()) return 'fuyao';
  if (adapter.name === 'ifind-stock' && adapter.isConfigured()) return 'ifind';
  return 'fallback';
}

// ---------- 影响分析计算（纯函数，供工作流 4 使用） ----------
export interface TargetImpact {
  code: string;
  name: string;
  origin: MarketOrigin;
  eventDate: string | null;
  eventDayPct: number | null; // 事件日涨跌幅 %
  nextDayPct: number | null; // 次日涨跌幅 %
  volumeRatio: number | null; // 事件日成交量 / 前20日均量
  windowPct: number | null; // 事件前后 [-5,+5] 区间涨跌幅 %
  anomaly: boolean; // |涨跌幅|>3% 或 量比>2
  kline: KlinePoint[];
  warnings: string[];
}

export function computeImpact(
  kline: KlinePoint[],
  eventDate: string | null,
  code: string,
  name: string,
  origin: MarketOrigin,
  warnings: string[],
): TargetImpact {
  const empty: TargetImpact = {
    code, name, origin, eventDate, eventDayPct: null, nextDayPct: null,
    volumeRatio: null, windowPct: null, anomaly: false, kline, warnings,
  };
  if (!eventDate || kline.length < 3) return empty;
  const idx = kline.findIndex((k) => k.date >= eventDate);
  if (idx <= 0) return empty;
  const day = kline[idx];
  const prev = kline[idx - 1];
  const next = kline[idx + 1];
  const eventDayPct = round2(((day.close - prev.close) / prev.close) * 100);
  const nextDayPct = next ? round2(((next.close - day.close) / day.close) * 100) : null;
  const before = kline.slice(Math.max(0, idx - 20), idx);
  const avgVol = before.length ? before.reduce((s, k) => s + k.volume, 0) / before.length : 0;
  const volumeRatio = avgVol > 0 ? round2(day.volume / avgVol) : null;
  const from = kline[Math.max(0, idx - 5)];
  const to = kline[Math.min(kline.length - 1, idx + 5)];
  const windowPct = round2(((to.close - from.close) / from.close) * 100);
  const anomaly = Math.abs(eventDayPct) >= 3 || (volumeRatio !== null && volumeRatio >= 2);
  return { ...empty, eventDayPct, nextDayPct, volumeRatio, windowPct, anomaly };
}

export function sentimentOfStatus(status: EventStatus): 1 | -1 | 0 {
  if (status === 'denied') return -1;
  if (status === 'expired') return 0;
  return 1;
}
