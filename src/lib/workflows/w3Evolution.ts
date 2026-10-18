import { getStore } from '@/lib/server/store';
import { STATUS_LABELS } from '@/lib/domain/vocabulary';
import type { EventStatus } from '@/lib/domain/types';
import { timed, type WorkflowNodeTrace, type WorkflowWarning } from './types';

// ============================================================
// 工作流 3：版本演化与状态追踪（Version Evolution）
// 识别状态变化：更新 / 更正 / 否认 / 过期 / 复活
// 判定新信息是对旧信息的补充还是推翻
// 通知机制：结论重大变化时触发提醒（更正/否认/复活=事实撤销类）
// 输出：事件状态演变图 + 变更通知
// ============================================================

export type EvolutionRelation = 'supplement' | 'correction' | 'overturn' | 'reactivation' | 'confirmation';

export interface EvolutionEdge {
  from: string; // version id，如 V1
  to: string;
  fromStatus: EventStatus;
  toStatus: EventStatus;
  relation: EvolutionRelation;
  relationLabel: string;
  at: string;
  reason: string;
  diffNote?: string;
}

export interface EvolutionNode {
  id: string;
  version: number;
  status: EventStatus;
  statusLabel: string;
  at: string;
  summary: string;
  evidenceCount: number;
}

const RELATION_LABELS: Record<EvolutionRelation, string> = {
  supplement: '补充',
  correction: '更正',
  overturn: '推翻',
  reactivation: '重新激活',
  confirmation: '确认',
};

function relationOf(to: EventStatus): EvolutionRelation {
  if (to === 'corrected') return 'correction';
  if (to === 'denied') return 'overturn';
  if (to === 'revived') return 'reactivation';
  return 'supplement';
}

export interface W3Result {
  nodes: WorkflowNodeTrace[];
  warnings: WorkflowWarning[];
  eventId: string;
  eventTitle: string;
  graph: { nodes: EvolutionNode[]; edges: EvolutionEdge[] };
  notifications: Array<{
    id: string;
    kind: string;
    kindLabel: string;
    title: string;
    body: string;
    diffNote?: string;
    createdAt: string;
    read: boolean;
  }>;
  majorChanges: number;
  narrative: string;
}

export async function runW3VersionEvolution(eventId: string): Promise<W3Result | null> {
  const store = await getStore();
  const event = store.getEvent(eventId);
  if (!event) return null;
  const warnings: WorkflowWarning[] = [];

  // ---- 节点 1：状态变化识别（补充 vs 推翻） ----
  const graphRun = timed(() => {
    const graphNodes: EvolutionNode[] = event.versions.map((v) => ({
      id: `V${v.version}`,
      version: v.version,
      status: v.status,
      statusLabel: STATUS_LABELS[v.status],
      at: v.changedAt,
      summary: v.summary,
      evidenceCount: v.evidenceSnapshot.length,
    }));
    const edges: EvolutionEdge[] = [];
    for (let i = 1; i < event.versions.length; i++) {
      const prev = event.versions[i - 1];
      const cur = event.versions[i];
      const statusChanged = prev.status !== cur.status;
      const rel: EvolutionRelation = statusChanged
        ? relationOf(cur.status)
        : cur.status === 'revived' || cur.status === 'updated'
          ? 'confirmation'
          : 'supplement';
      edges.push({
        from: `V${prev.version}`,
        to: `V${cur.version}`,
        fromStatus: prev.status,
        toStatus: cur.status,
        relation: rel,
        relationLabel: RELATION_LABELS[rel],
        at: cur.changedAt,
        reason: cur.reason,
        diffNote: cur.diffNote,
      });
    }
    return { graphNodes, edges };
  });
  const overturnCount = graphRun.value.edges.filter((e) => e.relation === 'overturn' || e.relation === 'correction').length;
  const supplementCount = graphRun.value.edges.filter((e) => e.relation === 'supplement' || e.relation === 'confirmation').length;
  const trace1: WorkflowNodeTrace = {
    node: '状态变化识别',
    engine: 'rules',
    durationMs: graphRun.ms,
    items: graphRun.value.edges.length,
    detail: `${event.versions.length} 个版本，${supplementCount} 次补充/确认，${overturnCount} 次更正/推翻`,
  };

  // ---- 节点 2：重大变化通知 ----
  const notifRun = timed(() =>
    store.notificationsOf(eventId).map((n) => ({
      id: n.id,
      kind: n.kind,
      kindLabel: n.kind === 'fact_revocation' ? '事实撤销' : n.kind === 'fact_update' ? '事实更新' : '状态信息',
      title: n.title,
      body: n.body,
      diffNote: n.diffNote,
      createdAt: n.createdAt,
      read: n.read,
    })),
  );
  const majorChanges = notifRun.value.filter((n) => n.kind === 'fact_revocation').length;
  const trace2: WorkflowNodeTrace = {
    node: '变更通知触发',
    engine: 'system',
    durationMs: notifRun.ms,
    items: notifRun.value.length,
    detail: `${notifRun.value.length} 条通知，其中 ${majorChanges} 条事实撤销类（更正/否认/反转，均带差异标注）`,
  };

  const narrative = buildNarrative(event.status, event.hasDenialRecord, graphRun.value.edges);
  return {
    nodes: [trace1, trace2],
    warnings,
    eventId,
    eventTitle: event.title,
    graph: { nodes: graphRun.value.graphNodes, edges: graphRun.value.edges },
    notifications: notifRun.value,
    majorChanges,
    narrative,
  };
}

function buildNarrative(status: EventStatus, hasDenialRecord: boolean, edges: EvolutionEdge[]): string {
  const parts: string[] = [];
  const denied = edges.find((e) => e.toStatus === 'denied');
  const revived = edges.find((e) => e.toStatus === 'revived');
  const corrected = edges.filter((e) => e.toStatus === 'corrected');
  const expired = edges.find((e) => e.toStatus === 'expired');
  if (denied && revived) parts.push('该事件曾被否认，后因高门槛证据反转，否认记录永久保留');
  else if (denied && status === 'denied') parts.push('该事件当前处于被否认状态，相关内容不应作为决策依据');
  if (corrected.length) parts.push(`经历 ${corrected.length} 次更正，以最新披露口径为准`);
  if (expired && status !== 'expired') parts.push('曾过期后因新进展重新激活');
  else if (expired) parts.push('事件已过期，不再演化');
  if (hasDenialRecord && !denied) parts.push('历史上存在否认记录');
  if (parts.length === 0) parts.push(`事件处于「${STATUS_LABELS[status]}」状态，按既有证据链持续演化`);
  return parts.join('；') + '。';
}
