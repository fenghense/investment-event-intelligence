import { NextRequest, NextResponse } from 'next/server';
import { HeaderUtils } from 'coze-coding-dev-sdk';
import { getStore } from '@/lib/server/store';
import type { EvidenceType, RawSourceItem, SourceType } from '@/lib/domain/types';

const VALID_SOURCE_TYPES: SourceType[] = [
  'announcement',
  'exchange',
  'media',
  'research',
  'official_social',
  'social',
  'personal',
];
const VALID_EVIDENCE_TYPES: EvidenceType[] = ['fact', 'opinion', 'speculation', 'rumor'];

interface IngestBody {
  title?: string;
  content?: string;
  sourceType?: string;
  sourceName?: string;
  url?: string;
  announcementNo?: string;
  disclosedAt?: string;
  bulletinType?: string;
  evidenceType?: string;
  officialConfirm?: boolean;
  interestRelated?: boolean;
  sourceHitRate?: number;
  extractorMode?: string;
  mode?: string;
}

export async function POST(request: NextRequest) {
  let body: IngestBody;
  try {
    body = (await request.json()) as IngestBody;
  } catch {
    return NextResponse.json({ error: '请求体必须是合法 JSON' }, { status: 400 });
  }

  if (!body.title || !body.content || !body.sourceName || !body.sourceType) {
    return NextResponse.json(
      { error: '缺少必填字段：title / content / sourceName / sourceType' },
      { status: 400 },
    );
  }
  if (!VALID_SOURCE_TYPES.includes(body.sourceType as SourceType)) {
    return NextResponse.json(
      { error: `sourceType 非法，允许值：${VALID_SOURCE_TYPES.join(' / ')}` },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const raw: RawSourceItem = {
    externalId: `MANUAL-${Date.now()}`,
    sourceType: body.sourceType as SourceType,
    sourceName: body.sourceName,
    title: body.title,
    content: body.content,
    url: body.url,
    announcementNo: body.announcementNo,
    disclosedAt: body.disclosedAt ?? now,
    fetchedAt: now,
    meta: {
      bulletinType: body.bulletinType,
      evidenceType: VALID_EVIDENCE_TYPES.includes(body.evidenceType as EvidenceType)
        ? (body.evidenceType as EvidenceType)
        : undefined,
      officialConfirm: body.officialConfirm ?? false,
      interestRelated: body.interestRelated ?? false,
      sourceHitRate: typeof body.sourceHitRate === 'number' ? body.sourceHitRate : 0.5,
    },
  };

  const store = await getStore();
  const forwardHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  const result = await store.ingest(raw, {
    extractorMode: body.extractorMode === 'llm' || body.mode === 'llm' ? 'llm' : 'rules',
    forwardHeaders,
  });

  return NextResponse.json(result);
}
