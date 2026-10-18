import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { IfindSourceAdapter, ifindConfigured } from '@/lib/adapters/ifind/adapter';
import { getStore } from '@/lib/server/store';

// 防止 Next 缓存 POST 响应
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface FetchBody {
  query?: string;
  // 时间窗（支持多种字段命名，统一归一化；全部未传才用默认最近半年）
  timeStart?: string;
  timeEnd?: string;
  time_start?: string;
  time_end?: string;
  startDate?: string;
  endDate?: string;
  start?: string;
  end?: string;
  dateFrom?: string;
  dateTo?: string;
  from?: string;
  to?: string;
  timeRange?: { start?: string; end?: string; startDate?: string; endDate?: string };
  size?: number;
  limit?: number;
  count?: number;
  /** 是否直接把拉取到的证据接入主链路（抽取/去重/状态机） */
  ingest?: boolean;
  mode?: 'rules' | 'llm';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 归一化日期：接受 YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD / 含时间戳，统一截为 YYYY-MM-DD */
function normalizeDate(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const s = input.trim();
  if (DATE_RE.test(s)) return s;
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const slash = s.replace(/\//g, '-');
  if (/^\d{4}-\d{1,2}-\d{1,2}/.test(slash)) return slash.slice(0, 10);
  const ms = Date.parse(s);
  if (!Number.isNaN(ms)) return new Date(ms).toISOString().slice(0, 10);
  return null;
}

function pickDate(body: FetchBody, keys: Array<keyof FetchBody>): string | null {
  for (const k of keys) {
    const v = body[k];
    if (typeof v === 'string' && v.trim()) return normalizeDate(v);
  }
  return null;
}

export async function POST(request: NextRequest) {
  let body: FetchBody;
  try {
    body = (await request.json()) as FetchBody;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  const query = (body.query ?? '').trim();
  if (!query) {
    return NextResponse.json({ error: '缺少必填字段：query（标的名称/代码/关键词）' }, { status: 400 });
  }

  // 用户显式时间窗（任意别名）优先；只有完全未传时才回落默认最近半年
  const explicitStart =
    pickDate(body, ['timeStart', 'time_start', 'startDate', 'start', 'dateFrom', 'from']) ??
    normalizeDate(body.timeRange?.start) ??
    normalizeDate(body.timeRange?.startDate);
  const explicitEnd =
    pickDate(body, ['timeEnd', 'time_end', 'endDate', 'end', 'dateTo', 'to']) ??
    normalizeDate(body.timeRange?.end) ??
    normalizeDate(body.timeRange?.endDate);

  const today = new Date().toISOString().slice(0, 10);
  const defaultStart = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  const timeStart = explicitStart ?? defaultStart;
  const timeEnd = explicitEnd ?? today;
  const usedDefaultWindow = !explicitStart && !explicitEnd;
  if (!DATE_RE.test(timeStart) || !DATE_RE.test(timeEnd)) {
    return NextResponse.json(
      { error: '时间窗必须为 YYYY-MM-DD（兼容 timeStart/timeEnd、time_start/time_end、startDate/endDate、timeRange 对象）' },
      { status: 400 },
    );
  }
  if (timeStart > timeEnd) {
    return NextResponse.json({ error: '开始日期不能晚于结束日期' }, { status: 400 });
  }
  const rawSize = body.size ?? body.limit ?? body.count;
  const size = Math.min(Math.max(Number(rawSize) || 10, 1), 20); // 额度保护：单次最多 20

  const adapter = new IfindSourceAdapter();
  const result = await adapter.fetchByTargetRange(query, timeStart, timeEnd, size);

  let ingestResults: unknown[] | undefined;
  if (body.ingest && result.items.length > 0) {
    const store = await getStore();
    const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
    ingestResults = [];
    for (const raw of result.items) {
      // 串行接入：内部抽取/去重各自独立，同时避免外部调用并发尖峰
      // eslint-disable-next-line no-await-in-loop
      const r = await store.ingest(raw, {
        extractorMode: body.mode === 'llm' ? 'llm' : 'rules',
        forwardHeaders,
      });
      ingestResults.push({
        externalId: raw.externalId,
        eventId: r.event.id,
        eventTitle: r.event.title,
        status: r.event.status,
        matchType: r.decision.matchType,
        credibility: r.event.credibility,
        warnings: r.warnings,
      });
    }
  }

  // 真实查询为空（远程成功但无结果）时给出明确建议，禁止让前端误当“服务降级”
  const remoteEmpty =
    result.origin === 'remote' &&
    result.items.length === 0 &&
    result.sources.some((s) => s.origin === 'remote' && s.count === 0);

  return NextResponse.json({
    configured: ifindConfigured(),
    query,
    timeRange: { start: timeStart, end: timeEnd, usedDefaultWindow },
    origin: result.origin,
    warnings: result.warnings,
    sources: result.sources,
    quota: result.quota,
    count: result.items.length,
    items: result.items,
    ...(remoteEmpty
      ? {
          emptyHint:
            '该时间窗内无匹配公告/新闻，建议：① 扩大时间范围；② 更换更宽泛的关键词（去掉“股份/有限公司”后缀或用简称）；③ 用公告中的原词检索',
        }
      : {}),
    ...(ingestResults ? { ingestResults } : {}),
  });
}
