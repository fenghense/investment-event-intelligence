import { NextResponse } from 'next/server';
import { getIfindQuota } from '@/lib/adapters/ifind/adapter';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** iFinD 凭证配置状态与本进程 MCP 调用次数（不返回任何凭证内容） */
export async function GET() {
  const quota = getIfindQuota();
  return NextResponse.json(quota);
}
