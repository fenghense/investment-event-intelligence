import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// 健康检查不调用外部数据源，也不返回任何环境变量或密钥。
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
