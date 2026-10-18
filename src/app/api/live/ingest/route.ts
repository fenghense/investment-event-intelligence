import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { getStore } from '@/lib/server/store';
import { getLiveItem } from '@/lib/adapters/liveRegistry';

// ============================================================
// 把 /api/live 汇聚到的某条【真实消息】接入 抽取→去重→状态机 主链路。
// 只接受最近由实时源登记的 externalId，拒绝任何外部构造的伪造内容。
// ============================================================

interface LiveIngestBody {
  externalId?: string;
  mode?: string;
  extractorMode?: string;
}

export async function POST(request: NextRequest) {
  let body: LiveIngestBody;
  try {
    body = (await request.json()) as LiveIngestBody;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }
  if (!body.externalId) {
    return NextResponse.json({ error: '缺少 externalId（必须来自 /api/live 的实时结果）' }, { status: 400 });
  }

  const found = getLiveItem(body.externalId);
  if (!found) {
    return NextResponse.json(
      { error: '实时条目不存在或已过期（超过 30 分钟），请重新刷新实时消息后再接入' },
      { status: 404 },
    );
  }

  const store = await getStore();
  const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const result = await store.ingest(found.item, {
    extractorMode:
      body.extractorMode === 'llm' || body.mode === 'llm' ? ('llm' as const) : ('rules' as const),
    forwardHeaders,
  });

  return NextResponse.json({ ...result, liveProvider: found.provider });
}
