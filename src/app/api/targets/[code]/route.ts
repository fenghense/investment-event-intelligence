import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';
import {
  computeImpact,
  getMarketAdapter,
  marketOrigin,
  MockMarketAdapter,
  type MarketOrigin,
  type TargetImpact,
} from '@/lib/adapters/fuyao/marketAdapter';
import { IfindStockAdapter } from '@/lib/adapters/ifind/stockAdapter';

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

/**
 * GET /api/targets/[code]
 * 标的整合视图：登记信息 + 关联事件（时间线）+ 行情快照与走势 +
 * 每个事件窗口的量价影响验证（computeImpact）+ iFinD 标的概况。
 * 非 A 股建档标的（NAME- 兜底主键）行情区如实标注不可用，不伪造。
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const store = await getStore();
  const target = store.getTarget(code);
  if (!target) {
    return NextResponse.json({ error: `标的不存在：${code}` }, { status: 404 });
  }
  const events = store
    .listEvents({ target: code })
    .map((e) => ({ ...e, evidenceCount: e.evidenceIds.length }));

  // ---- 行情与影响验证（一次 K 线拉取，全部事件复用） ----
  const isStockCode = !code.startsWith('NAME-') && !code.startsWith('ENT-');
  const adapter = getMarketAdapter();
  const origin: MarketOrigin = marketOrigin(adapter);
  const warnings: string[] = [];
  let quote = null as null | { code: string; name: string; price: number; pctChange: number; updatedAt: string };
  let kline: TargetImpact['kline'] = [];
  let profile: string | null = null;
  const impacts: Record<string, TargetImpact> = {};

  if (isStockCode) {
    const today = new Date().toISOString().slice(0, 10);
    const start = shiftDate(today, -150);
    try {
      const data =
        adapter instanceof MockMarketAdapter
          ? adapter.generate(
              code,
              start,
              today,
              events
                .map((e) => e.eventTime)
                .filter((d): d is string => Boolean(d))
                .map((d) => ({ date: d, sentiment: 1 as const })),
            )
          : await adapter.getKline(code, start, today);
      quote = data.quote ? { ...data.quote, name: target.name } : null;
      kline = data.kline;
      warnings.push(...data.warnings);
      for (const e of events) {
        const eventDate = e.eventTime ?? e.versions[0]?.changedAt.slice(0, 10) ?? null;
        impacts[e.id] = computeImpact(kline, eventDate, code, target.name, data.origin, []);
      }
    } catch (err) {
      warnings.push(`行情拉取失败：${err instanceof Error ? err.message : String(err)}`);
    }
    if (adapter instanceof IfindStockAdapter) {
      profile = await adapter.getProfile(code, target.name);
    }
  } else {
    warnings.push('该标的为非 A 股建档主体（无标准证券代码），暂无行情验证数据');
  }

  return NextResponse.json({
    target,
    events,
    market: { origin, quote, kline: kline.slice(-80), warnings },
    impacts,
    profile: profile ? { text: profile, source: '同花顺iFinD·股票概况' } : null,
  });
}
