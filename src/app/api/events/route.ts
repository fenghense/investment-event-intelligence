import { NextRequest, NextResponse } from 'next/server';
import { getStore } from '@/lib/server/store';
import type { EventStatus } from '@/lib/domain/types';

const VALID_STATUS: EventStatus[] = ['published', 'updated', 'corrected', 'denied', 'expired', 'revived'];

export async function GET(request: NextRequest) {
  const store = await getStore();
  const sp = request.nextUrl.searchParams;
  const status = sp.get('status');
  const target = sp.get('target') ?? undefined;
  const q = sp.get('q') ?? undefined;

  const events = store.listEvents({
    status: status && VALID_STATUS.includes(status as EventStatus) ? (status as EventStatus) : undefined,
    target,
    q,
  });

  return NextResponse.json({
    events: events.map((e) => ({
      ...e,
      evidenceCount: e.evidenceIds.length,
      favorited: store.isFavorited(e.id),
    })),
    stats: store.stats(),
  });
}
