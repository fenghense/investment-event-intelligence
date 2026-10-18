import { NextRequest, NextResponse } from 'next/server';
import { getMarketAdapter, MockMarketAdapter } from '@/lib/adapters/fuyao/marketAdapter';

// 行情数据：事件详情页影响分析图表使用
// 优先扶摇，其次已配置的 iFinD；均未配置时显式返回演示行情。
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const { searchParams } = new URL(request.url);
  const end = searchParams.get('end') ?? new Date().toISOString().slice(0, 10);
  const start = searchParams.get('start') ?? shiftDate(end, -40);
  const eventDate = searchParams.get('eventDate');
  const sentimentParam = searchParams.get('sentiment');

  const adapter = getMarketAdapter();
  try {
    if (adapter instanceof MockMarketAdapter) {
      const sentiment = sentimentParam === '-1' ? -1 : sentimentParam === '0' ? 0 : 1;
      const windows = eventDate ? [{ date: eventDate, sentiment: sentiment as 1 | -1 | 0 }] : [];
      return NextResponse.json(adapter.generate(code, start, end, windows));
    }
    const result = await adapter.getKline(code, start, end);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `行情拉取失败：${msg}` }, { status: 502 });
  }
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
