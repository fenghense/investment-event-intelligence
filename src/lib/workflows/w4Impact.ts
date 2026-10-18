import { getStore } from '@/lib/server/store';
import {
  getMarketAdapter,
  computeImpact,
  sentimentOfStatus,
  MockMarketAdapter,
  type MarketOrigin,
  type TargetImpact,
} from '@/lib/adapters/fuyao/marketAdapter';
import { TARGET_ROLE_LABELS } from '@/lib/domain/vocabulary';
import { timedAsync, timed, type WorkflowNodeTrace, type WorkflowWarning } from './types';

// ============================================================
// 工作流 4：标的关联与影响分析（Entity Linking & Impact）
// 关联事件涉及的标的（股票/行业/板块），用扶摇行情验证事件影响
// （股价异动、成交量变化），生成事件影响摘要
// 输出：事件-标的关系图谱 + 影响分析
// ============================================================

export interface W4Result {
  nodes: WorkflowNodeTrace[];
  warnings: WorkflowWarning[];
  eventId: string;
  eventTitle: string;
  relationGraph: {
    center: string;
    targets: Array<{ code: string; name: string; role: string; roleLabel: string; market?: string; industry?: string }>;
  };
  impacts: TargetImpact[];
  summary: string;
  marketOrigin: MarketOrigin;
}

export async function runW4ImpactAnalysis(eventId: string): Promise<W4Result | null> {
  const store = await getStore();
  const event = store.getEvent(eventId);
  if (!event) return null;
  const warnings: WorkflowWarning[] = [];

  // ---- 节点 1：标的关联（主体/对象/提及 + 行业板块，剔除占位对象「未指明」） ----
  const linkRun = timed(() =>
    event.targets
      .filter((t) => t.name !== '未指明' && t.name !== '未知主体')
      .map((t) => {
        const meta = store.getTarget(t.code);
        return {
          code: t.code,
          name: t.name,
          role: t.role,
          roleLabel: TARGET_ROLE_LABELS[t.role],
          market: meta?.market,
          industry: meta?.industry,
        };
      }),
  );
  const trace1: WorkflowNodeTrace = {
    node: '标的关联',
    engine: 'rules',
    durationMs: linkRun.ms,
    items: linkRun.value.length,
    detail: linkRun.value.map((t) => `${t.name}(${t.roleLabel}${t.industry ? `/${t.industry}` : ''})`).join('、') || '未关联到登记标的',
  };

  // ---- 节点 2：扶摇行情验证（事件窗口量价异动） ----
  const adapter = getMarketAdapter();
  const eventDate = event.eventTime ?? event.versions[0]?.changedAt.slice(0, 10) ?? null;
  const center = eventDate ?? new Date().toISOString().slice(0, 10);
  const start = shiftDate(center, -30);
  const end = shiftDate(center, 10);
  const sentiment = sentimentOfStatus(event.status);

  const marketRun = await timedAsync(async () => {
    const impacts: TargetImpact[] = [];
    for (const t of linkRun.value) {
      // 非 A 股建档主体（NAME-/ENT- 兜底主键）无行情可验，如实标注并跳过远程拉取
      if (t.code.startsWith('NAME-') || t.code.startsWith('ENT-')) {
        impacts.push(
          computeImpact([], eventDate, t.code, t.name, 'ifind', ['非 A 股建档主体，暂无行情验证数据']),
        );
        continue;
      }
      if (adapter instanceof MockMarketAdapter) {
        const data = adapter.generate(t.code, start, end, eventDate ? [{ date: eventDate, sentiment }] : []);
        impacts.push(computeImpact(data.kline, eventDate, t.code, t.name, data.origin, data.warnings));
      } else {
        try {
          const data = await adapter.getKline(t.code, start, end);
          impacts.push(computeImpact(data.kline, eventDate, t.code, t.name, data.origin, data.warnings));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          warnings.push({ stage: 'market', message: `扶摇行情拉取失败（${t.name}）：${msg}，该标的影响分析暂缺` });
          impacts.push(computeImpact([], eventDate, t.code, t.name, 'fuyao', [`行情拉取失败：${msg}`]));
        }
      }
    }
    return impacts;
  });
  const marketOrigin = marketRun.value[0]?.origin ?? 'fallback';
  marketRun.value.forEach((i) => warnings.push(...i.warnings.map((w) => ({ stage: 'market', message: `${i.name}：${w}` }))));
  const anomalyCount = marketRun.value.filter((i) => i.anomaly).length;
  const trace2: WorkflowNodeTrace = {
    node: '行情影响验证',
    engine: 'system',
    durationMs: marketRun.ms,
    items: marketRun.value.length,
    detail: `数据源=${marketOrigin === 'fuyao' ? '扶摇实时' : marketOrigin === 'ifind' ? 'iFinD 实时行情' : '演示降级行情'}；${anomalyCount}/${marketRun.value.length} 个标的在事件窗口出现量价异动（|涨跌|≥3% 或量比≥2）`,
  };

  // ---- 节点 3：影响摘要生成 ----
  const summaryRun = timed(() =>
    buildImpactSummary(event.title, event.status, marketRun.value, marketOrigin),
  );
  const trace3: WorkflowNodeTrace = {
    node: '影响摘要生成',
    engine: 'rules',
    durationMs: summaryRun.ms,
    items: 1,
    detail: '规则模板生成（LLM 摘要接口预留）',
  };

  return {
    nodes: [trace1, trace2, trace3],
    warnings,
    eventId,
    eventTitle: event.title,
    relationGraph: { center: event.title, targets: linkRun.value },
    impacts: marketRun.value,
    summary: summaryRun.value,
    marketOrigin,
  };
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildImpactSummary(title: string, status: string, impacts: TargetImpact[], origin: string): string {
  if (impacts.length === 0) return `「${title}」未关联到可验证行情的标的，暂无法生成影响分析。`;
  const parts: string[] = [];
  for (const i of impacts) {
    if (i.eventDayPct === null) {
      parts.push(`${i.name}：事件窗口内无有效行情数据`);
      continue;
    }
    const dir = i.eventDayPct > 0 ? '上涨' : i.eventDayPct < 0 ? '下跌' : '持平';
    const vol = i.volumeRatio !== null ? `，量能放大至 20 日均量的 ${i.volumeRatio} 倍` : '';
    const win = i.windowPct !== null ? `，事件前后区间累计 ${i.windowPct >= 0 ? '+' : ''}${i.windowPct}%` : '';
    parts.push(`${i.name}事件日${dir} ${Math.abs(i.eventDayPct)}%${vol}${win}${i.anomaly ? '，构成显著异动' : '，未构成显著异动'}`);
  }
  const sourceNote = origin === 'fallback' ? '（基于演示降级行情，接入真实行情源后自动切换）' : '';
  return `「${title}」影响分析${sourceNote}：${parts.join('；')}。`;
}
