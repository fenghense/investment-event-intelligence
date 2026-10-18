// ============================================================
// 同花顺 iFinD MCP 客户端（Streamable HTTP 传输）
// 协议：JSON-RPC 2.0 over Streamable HTTP
// 安全：token 仅从此模块读取并用于 Authorization 头，禁止日志输出
// ============================================================

/** iFinD MCP 业务层统一返回结构：result.content[0].text 是 JSON 字符串 */
export interface IfindEnvelope<T = unknown> {
  code: number; // 1 表示成功
  msg?: string;
  data?: T;
}

export interface McpCallOptions {
  /** 整体请求超时（含重试），毫秒 */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 单次底层 HTTP 调用统计 */
interface CallStat {
  at: string;
  tool: string;
  ok: boolean;
  /** 重试次数（首调失败后才会 >0） */
  attempts: number;
  latencyMs: number;
  /** 错误摘要（脱敏，不含 token/URL） */
  error?: string;
}

const MIN_INTERVAL_MS = 1100; // 相邻调用间隔 >=1s（额度与限流保护）
const MAX_RETRIES = 2; // 首调失败后最多再试 2 次（共 3 次）
const RETRY_BACKOFF_MS = [1000, 2000];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 可重试的错误：网络异常 / 超时 / 429 / 5xx。
 * 4xx（除 429）属于鉴权或参数问题，重试无意义。
 */
class RetryableError extends Error {}
class FatalMcpError extends Error {}

export class IfindMcpClient {
  private readonly url: string;
  private readonly token: string;
  private sessionId: string | null = null;
  private initializing: Promise<void> | null = null;
  private lastCallAt = 0;
  private rpcId = 0;
  private readonly stats: CallStat[] = [];
  /** 进程内底层 HTTP 尝试计数（含 initialize / 重试，反映真实 MCP 消耗） */
  private callCount = 0;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  /** 是否配置了可用凭证（不返回凭证本身） */
  isConfigured(): boolean {
    return Boolean(this.url && this.token);
  }

  getQuota(): { calls: number; recent: CallStat[] } {
    return { calls: this.callCount, recent: this.stats.slice(-20) };
  }

  private nextId(): number {
    this.rpcId += 1;
    return this.rpcId;
  }

  /** 全局限流：保证相邻 MCP 调用间隔 >=1s */
  private async acquireSlot(): Promise<void> {
    const wait = MIN_INTERVAL_MS - (Date.now() - this.lastCallAt);
    if (wait > 0) await sleep(wait);
    this.lastCallAt = Date.now();
  }

  /** initialize + notifications/initialized，幂等（并发只初始化一次） */
  private async initialize(): Promise<void> {
    if (this.sessionId) return;
    if (this.initializing) return this.initializing;
    this.initializing = this.doInitialize().finally(() => {
      this.initializing = null;
    });
    return this.initializing;
  }

  private async doInitialize(): Promise<void> {
    const body = {
      jsonrpc: '2.0',
      id: this.nextId(),
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ifind-adapter', version: '1.0' },
      },
    };
    const res = await this.rawPost(body, undefined);
    const sid = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
    if (!sid) {
      throw new RetryableError('MCP initialize 未返回 mcp-session-id');
    }
    this.sessionId = sid;
    // notifications/initialized：通知无需 id，服务端一般返回 202/空体
    await this.rawPost(
      { jsonrpc: '2.0', method: 'notifications/initialized', params: {} },
      this.sessionId,
    ).catch(() => {
      // 通知端点空响应/拒绝不阻塞后续 tools/call
    });
  }

  /** 调用 MCP 工具，返回解析后的 iFinD 业务信封 */
  async callTool<T = unknown>(
    tool: string,
    args: Record<string, unknown>,
    opts?: McpCallOptions,
  ): Promise<IfindEnvelope<T>> {
    if (!this.isConfigured()) {
      throw new FatalMcpError('IFIND_MCP_URL / IFIND_API_TOKEN 未配置');
    }
    const startedAt = Date.now();
    let lastErr: Error = new RetryableError('未执行');
    let attempts = 0;

    for (let i = 0; i <= MAX_RETRIES; i += 1) {
      attempts = i + 1;
      try {
        await this.initialize();
        await this.acquireSlot();
        const payload = {
          jsonrpc: '2.0',
          id: this.nextId(),
          method: 'tools/call',
          params: { name: tool, arguments: args },
        };
        const res = await this.rawPost(payload, this.sessionId ?? undefined, opts);
        const json = await this.parseResponse(res);

        // 业务信封可能藏在多个位置：content[*].text（JSON 字符串/Markdown 文本）、structuredContent
        const envelope = this.extractEnvelope<T>(json?.result);
        if (!envelope) {
          if (json?.error) {
            throw new FatalMcpError(`MCP 错误 ${json.error.code ?? ''}: ${json.error.message ?? ''}`);
          }
          throw new RetryableError('MCP 响应缺少 result.content[*].text');
        }
        this.record(tool, true, attempts, Date.now() - startedAt);
        if (envelope.code !== 1) {
          // 业务失败（额度不足等）：不重试，交给上层降级
          throw new FatalMcpError(`iFinD 业务失败：code=${envelope.code} msg=${envelope.msg ?? ''}`);
        }
        return envelope;
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (e instanceof FatalMcpError) {
          this.record(tool, false, attempts, Date.now() - startedAt, e.message);
          throw e;
        }
        lastErr = e;
        // 会话失效：重置后下一轮重新 initialize
        if (/session/i.test(e.message)) {
          this.sessionId = null;
        }
        if (i < MAX_RETRIES) {
          await sleep(RETRY_BACKOFF_MS[i] ?? 4000);
        }
      }
    }
    this.record(tool, false, attempts, Date.now() - startedAt, lastErr.message);
    throw new RetryableError(`iFinD 调用失败（重试 ${MAX_RETRIES} 次后）：${lastErr.message}`);
  }

  private record(tool: string, ok: boolean, attempts: number, latencyMs: number, error?: string): void {
    this.stats.push({
      at: new Date().toISOString(),
      tool,
      ok,
      attempts,
      latencyMs,
      ...(error ? { error: error.slice(0, 160) } : {}),
    });
    if (this.stats.length > 100) this.stats.shift();
  }

  private async rawPost(
    body: unknown,
    sessionId: string | undefined,
    opts?: McpCallOptions,
  ): Promise<Response> {
    this.callCount += 1; // 每次底层 HTTP 尝试都计入（含 initialize 与失败重试）
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15000);
    opts?.signal?.addEventListener('abort', () => controller.abort());
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      };
      if (sessionId) headers['Mcp-Session-Id'] = sessionId;
      const res = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        if (res.status === 429 || res.status >= 500) {
          throw new RetryableError(`HTTP ${res.status}`);
        }
        throw new FatalMcpError(`HTTP ${res.status}（鉴权或参数问题，不重试）`);
      }
      return res;
    } catch (err) {
      if (err instanceof FatalMcpError || err instanceof RetryableError) throw err;
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new RetryableError('请求超时');
      }
      throw new RetryableError(err instanceof Error ? err.message : '网络错误');
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * 从 tools/call 结果中提取 iFinD 业务信封。
   * 兼容真实线上多种返回形态：
   *  - content[n].text 是业务 JSON 字符串：{"code":1,"msg":"success","data":[...]}
   *  - result.structuredContent 直接携带业务对象
   *  - text 是非 JSON 的纯文本（如 '# 查询结果\n...' Markdown）：作为 data 原样上抛，由 adapter 解析
   *  - 部分网关直接在 result 上返回 code/data
   */
  private extractEnvelope<T>(
    result:
      | {
          content?: Array<{ type?: string; text?: string }>;
          structuredContent?: unknown;
          code?: number;
          msg?: string;
          data?: unknown;
        }
      | undefined,
  ): IfindEnvelope<T> | null {
    if (!result) return null;

    // 1) result 顶层即业务信封（部分网关形态）
    if (typeof result.code === 'number') {
      return { code: result.code, msg: result.msg, data: result.data as T };
    }

    // 2) structuredContent：MCP 结构化输出
    const sc = result.structuredContent as IfindEnvelope<T> | undefined;
    if (sc && typeof sc === 'object' && typeof sc.code === 'number') return sc;

    // 3) 遍历所有 content block（不局限于 [0]）
    const blocks = Array.isArray(result.content) ? result.content : [];
    for (const block of blocks) {
      const text = block?.text;
      if (typeof text !== 'string' || !text.trim()) continue;
      const trimmed = text.trim();
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (parsed && typeof parsed === 'object' && typeof (parsed as IfindEnvelope<T>).code === 'number') {
          return parsed as IfindEnvelope<T>;
        }
      } catch {
        // 非 JSON：Markdown/纯文本片段，整体作为 data 上抛（adapter 用 Markdown 解析兜底）
        return { code: 1, msg: 'text-plain', data: trimmed as unknown as T };
      }
    }
    return null;
  }

  /**
   * 解析响应：服务端可能返回 application/json，也可能返回 text/event-stream。
   * SSE 帧形如 `data: {...}\n\n`，取最后一个含 jsonrpc 的 data。
   */
  private async parseResponse(res: Response): Promise<{
    result?: {
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: unknown;
      code?: number;
      msg?: string;
      data?: unknown;
    };
    error?: { code?: number; message?: string };
  }> {
    const raw = await res.text();
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/event-stream')) {
      const dataLines = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim());
      for (let i = dataLines.length - 1; i >= 0; i -= 1) {
        try {
          return JSON.parse(dataLines[i]);
        } catch {
          // 继续向前找可解析帧
        }
      }
      throw new RetryableError('SSE 响应无可解析的 data 帧');
    }
    return JSON.parse(raw);
  }
}
