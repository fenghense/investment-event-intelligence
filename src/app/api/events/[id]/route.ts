import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';
import type { EventDetailResponse, EventVersion, TimelineEntry } from '@/lib/domain/types';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = await getStore();
  const event = store.getEvent(id);
  if (!event) {
    return NextResponse.json({ error: `事件不存在：${id}` }, { status: 404 });
  }

  const evidence = store.evidenceOf(event.id);
  const notifications = store.notificationsOf(event.id);

  // 时间线 = 事件建立 + 证据收录（按披露时间） + 状态变更（关联版本快照），合并升序
  const findVersion = (at: string, status: string): EventVersion => {
    return (
      event.versions.find((v) => v.changedAt === at && v.status === status) ??
      event.versions[event.versions.length - 1]
    );
  };

  const createdEntry: TimelineEntry = {
    kind: 'created',
    at: event.createdAt,
    detail: `经去重合并链路建立事件档案，dedup_key = ${event.dedupKey}，首条证据来源：${
      evidence[0]?.sourceName ?? '—'
    }`,
  };

  const timeline: TimelineEntry[] = [
    createdEntry,
    ...evidence.map(
      (e): TimelineEntry => ({
        kind: 'evidence',
        at: e.disclosedAt,
        evidence: e,
      }),
    ),
    ...event.statusHistory.map(
      (s): TimelineEntry => ({
        kind: 'status',
        at: s.at,
        fromStatus: s.from,
        toStatus: s.to,
        version: {
          ...findVersion(s.at, s.to),
          reason: s.reason,
          diffNote: s.diffNote ?? findVersion(s.at, s.to).diffNote,
        },
      }),
    ),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const response: EventDetailResponse = {
    event: { ...event, favorited: store.isFavorited(event.id) },
    evidence,
    notifications,
    timeline,
  };
  return NextResponse.json(response);
}
