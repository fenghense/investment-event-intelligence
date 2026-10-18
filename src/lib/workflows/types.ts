// 工作流节点轨迹与公共类型
export interface WorkflowNodeTrace {
  node: string;
  engine: 'rules' | 'llm' | 'llm-fallback' | 'system';
  durationMs: number;
  detail: string;
  items?: number;
}

export interface WorkflowWarning {
  stage: string;
  message: string;
}

export function timed<T>(fn: () => T): { value: T; ms: number } {
  const t0 = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t0 };
}

export async function timedAsync<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - t0 };
}

/**
 * 透传头白名单：原始请求头中的 hop-by-hop 头（content-length/host/connection 等）
 * 会让 LLM 网关按错误长度等待 body 导致调用挂起，必须剔除。
 */
const HOP_BY_HOP = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive',
  'upgrade', 'expect', 'te', 'trailer', 'proxy-authenticate', 'proxy-authorization',
]);

function sanitizeForwardHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

/** 统一调用 LLM 并解析 JSON 输出；失败抛错由调用方显式降级。带超时保护（默认 45s），防止 LLM 挂起拖垮工作流。 */
export async function callLlmJson<T>(
  prompt: string,
  forwardHeaders?: Record<string, string>,
  timeoutMs = 45_000,
): Promise<T> {
  const { LLMClient, Config } = await import('coze-coding-dev-sdk');
  const client = new LLMClient(new Config(), sanitizeForwardHeaders(forwardHeaders));
  const invoke = client.invoke([{ role: 'user', content: prompt }], { temperature: 0.1 });
  const guard = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`LLM 调用超时（${timeoutMs / 1000}s）`)), timeoutMs),
  );
  const response = await Promise.race([invoke, guard]);
  const text = response.content.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('LLM 输出不含 JSON 对象');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}
