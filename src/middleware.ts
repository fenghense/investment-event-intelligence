import { NextRequest, NextResponse } from 'next/server';

// ============================================================
// 开放 API 跨域支持
// 前端托管在 GitHub Pages 等静态站点，浏览器跨域直调本服务的
// /api/* 接口。middleware 统一注入 CORS 响应头并接管 OPTIONS 预检。
// 仅作用于 /api 命名空间，页面路由不受影响。
// ============================================================

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export function middleware(request: NextRequest): NextResponse {
  const origin = request.headers.get('origin') ?? '*';

  // 预检请求：直接 204 放行，不进路由处理器
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
  }

  const response = NextResponse.next();
  const headers = corsHeaders(origin);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
