import { NextRequest, NextResponse } from 'next/server';
import { runW1EventIngestion } from '@/lib/workflows/w1Ingestion';
import { runW2EvidenceGrading } from '@/lib/workflows/w2Grading';
import { runW3VersionEvolution } from '@/lib/workflows/w3Evolution';
import { runW4ImpactAnalysis } from '@/lib/workflows/w4Impact';

// 工作流编排入口：w1 事件采集与去重 / w2 证据分级与时间线 / w3 版本演化 / w4 标的关联与影响
// 触发：手动输入（本接口）或定时任务（复用同一函数入口）
export async function POST(request: NextRequest) {
  let body: {
    workflow?: 'w1' | 'w2' | 'w3' | 'w4';
    eventId?: string;
    query?: string;
    timeStart?: string;
    timeEnd?: string;
    size?: number;
    useLlmLinking?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const forwardHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    forwardHeaders[key] = value;
  });

  try {
    switch (body.workflow) {
      case 'w1': {
        if (!body.query?.trim()) {
          return NextResponse.json({ error: 'w1 需要 query（标的名/代码/关键词）' }, { status: 400 });
        }
        const end = body.timeEnd ?? new Date().toISOString().slice(0, 10);
        const start = body.timeStart ?? shiftDate(end, -180);
        const result = await runW1EventIngestion({
          query: body.query.trim(),
          timeStart: start,
          timeEnd: end,
          size: body.size,
          useLlmLinking: body.useLlmLinking !== false,
          forwardHeaders,
        });
        return NextResponse.json({ workflow: 'w1', ...result });
      }
      case 'w2': {
        if (!body.eventId) return NextResponse.json({ error: 'w2 需要 eventId' }, { status: 400 });
        const result = await runW2EvidenceGrading(body.eventId);
        if (!result) return NextResponse.json({ error: '事件不存在' }, { status: 404 });
        return NextResponse.json({ workflow: 'w2', ...result });
      }
      case 'w3': {
        if (!body.eventId) return NextResponse.json({ error: 'w3 需要 eventId' }, { status: 400 });
        const result = await runW3VersionEvolution(body.eventId);
        if (!result) return NextResponse.json({ error: '事件不存在' }, { status: 404 });
        return NextResponse.json({ workflow: 'w3', ...result });
      }
      case 'w4': {
        if (!body.eventId) return NextResponse.json({ error: 'w4 需要 eventId' }, { status: 400 });
        const result = await runW4ImpactAnalysis(body.eventId);
        if (!result) return NextResponse.json({ error: '事件不存在' }, { status: 404 });
        return NextResponse.json({ workflow: 'w4', ...result });
      }
      default:
        return NextResponse.json({ error: 'workflow 必须是 w1/w2/w3/w4' }, { status: 400 });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `工作流执行失败：${msg}` }, { status: 500 });
  }
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
