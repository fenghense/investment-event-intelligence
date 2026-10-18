import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// ============================================================
// 开放 API 自描述索引
// GitHub Pages 等静态前端可通过 GET /api 发现全部可用端点。
// ============================================================

interface EndpointDoc {
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  params?: string;
  body?: string;
  returns: string;
}

const GROUPS: { group: string; endpoints: EndpointDoc[] }[] = [
  {
    group: '事件',
    endpoints: [
      {
        method: 'GET',
        path: '/api/events',
        summary: '事件监控列表（含状态/可信度/收藏标记/统计）',
        params: 'status(可选): published|updated|corrected|denied|expired|revived',
        returns: '{ events: InvestmentEvent[] & {evidenceCount, favorited}, stats }',
      },
      {
        method: 'GET',
        path: '/api/events/{id}',
        summary: '事件详情：要素卡 + 证据 + 版本链 + 时间线 + 通知',
        returns: '{ event, evidence, versions, timeline, notifications }',
      },
      {
        method: 'POST',
        path: '/api/events/{id}/favorite',
        summary: '收藏/取消收藏事件（切换式），收藏后其状态变更通知才进通知中心',
        returns: '{ eventId, favorited, favoriteCount }',
      },
      {
        method: 'POST',
        path: '/api/ingest',
        summary: '接入新证据（进入 抽取→去重合并→评分→状态机 主链路）',
        body: '{ title, content, sourceType, sourceName, url?, announcementNo?, bulletinType?, disclosedAt, meta?, mode?: "rules"|"llm" }',
        returns: '{ evidence, event, matched, transition, revivalCheck?, warnings }',
      },
    ],
  },
  {
    group: '搜索',
    endpoints: [
      {
        method: 'GET',
        path: '/api/search',
        summary: '全局搜索：命中标的与事件，空结果给出原因指引与建议词',
        params: 'q: 关键词（公司名/标的代码/事件关键词）',
        returns: '{ q, targets, events, suggestions, emptyHints? }',
      },
    ],
  },
  {
    group: '通知',
    endpoints: [
      {
        method: 'GET',
        path: '/api/notifications',
        summary: '通知中心（仅已收藏事件的状态变更通知）',
        returns: '{ notifications, unread, favoriteCount }',
      },
      {
        method: 'POST',
        path: '/api/notifications/{id}/read',
        summary: '标记通知已读',
        returns: '{ notification }',
      },
    ],
  },
  {
    group: '标的',
    endpoints: [
      {
        method: 'GET',
        path: '/api/targets',
        summary: '标的列表（含事件数/活跃数）',
        returns: '{ targets }',
      },
      {
        method: 'GET',
        path: '/api/targets/{code}',
        summary: '标的详情 + 关联事件',
        returns: '{ target, events }',
      },
    ],
  },
  {
    group: 'Agent 工作流',
    endpoints: [
      {
        method: 'POST',
        path: '/api/workflows/run',
        summary: '运行 W1-W4 工作流，返回节点轨迹 WorkflowNodeTrace[]',
        body: 'w1: { workflow:"w1", query, size? }；w2/w3/w4: { workflow, eventId }',
        returns: '{ workflow, nodes, warnings, ...workflowResult }',
      },
      {
        method: 'GET',
        path: '/api/market/{code}',
        summary: '行情数据（扶摇，未配置时为确定性演示行情并显式标注 origin:fallback）',
        params: 'start?, end?, eventDate?, sentiment?',
        returns: '{ origin, quote, kline }',
      },
    ],
  },
  {
    group: '实时多源消息',
    endpoints: [
      {
        method: 'POST',
        path: '/api/live',
        summary: '多源实时汇聚（巨潮公开公告 + iFinD 新闻/热门 + 财经媒体 36氪/虎嗅/钛媒体），按披露时间倒序；真实路径绝不返回种子',
        body: '{ q? 关键词, days?: 1|7|30=7, start?/end? 或 time_start/time_end, sources?: ["cninfo","ifind-news","ifind-trending","media"|"media-kr36"|"media-huxiu"|"media-tmtpost"], industry?, pageSize? }',
        returns:
          '{ items[](provider,来源徽标,四时间戳,公告编号/原文链接), count, origin(remote|cache|fallback), sources[每源状态], warnings, emptyHint?, timeRange }（仅所有真实源都失败才 origin:fallback+“数据服务暂不可用”，不展示演示内容）',
      },
      {
        method: 'POST',
        path: '/api/live/ingest',
        summary: '把 /api/live 的某条真实消息凭 externalId 接入 抽取→去重→状态机 主链路（拒绝外部伪造内容）',
        body: '{ externalId, mode?: "rules"|"llm" }（条目 30 分钟内有效）',
        returns: '{ evidence, event, decision, warnings, liveProvider }',
      },
    ],
  },
  {
    group: '数据源',
    endpoints: [
      {
        method: 'POST',
        path: '/api/ifind/fetch',
        summary: 'iFinD MCP 拉取公告/新闻（缓存+限流+降级链）',
        body:
          '{ query, timeStart?|time_start?|startDate?|timeRange?:{start,end}, timeEnd?|time_end?|endDate?, size?|limit?, ingest?, mode? }（时间窗全部未传才默认最近半年；兼容 YYYY-MM-DD/YYYY/MM/DD/YYYYMMDD）',
        returns:
          '{ configured, origin(remote|cache|fallback), timeRange:{start,end,usedDefaultWindow}, items, warnings, emptyHint?, ingestResults? }（远程成功但无结果返回 origin:remote+空 items+emptyHint，不回退种子）',
      },
      {
        method: 'GET',
        path: '/api/ifind/quota',
        summary: 'iFinD MCP 本进程底层调用计数',
        returns: '{ configured, mcpCalls }',
      },
    ],
  },
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  const domain = process.env.RENDER_EXTERNAL_URL ?? process.env.COZE_PROJECT_DOMAIN_DEFAULT;
  const baseUrl = domain
    ? (/^https?:\/\//.test(domain) ? domain : `https://${domain}`).replace(/\/$/, '')
    : request.nextUrl.origin;
  return NextResponse.json({
    name: '投资事件情报平台 Open API',
    version: 'v7',
    baseUrl,
    cors: '全端点已开放跨域（反射 Origin），可直接被 GitHub Pages 等静态前端 fetch 调用',
    conventions: {
      timestamps: 'ISO 8601 字符串；证据含 disclosed_at/fetched_at/event_occurred_at/updated_at 四时间戳',
      status: 'published 初发布 / updated 有更新 / corrected 已更正 / denied 已否认 / expired 已过期 / revived 反转',
      evidenceType: 'fact 事实 / opinion 观点 / speculation 推测 / rumor 传闻',
      sourceType: 'announcement 公告 / exchange 交易所披露 / media 权威媒体 / research 研报 / official_social 官方社媒 / social 社交媒体 / personal 个人传闻',
      degradation: '外部数据源不可用时显式降级并标注 origin:fallback 与 warnings，绝不伪造实时数据',
    },
    groups: GROUPS,
  });
}
