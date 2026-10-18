import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FuyaoHttpAdapter, fuyaoStockCode } from '../src/lib/adapters/fuyao/httpAdapter';

const day = Date.parse('2026-10-16T00:00:00+08:00');
const history = { timestamp: day, item: [
  { date_ms: day, open_price: 100, high_price: 104, low_price: 99, close_price: 102, volume: 123400 },
] };
const snapshot = { timestamp: day + 15 * 3600_000, item: [
  { thscode: '300750.SZ', ticker: '300750', last_price: 103, price_change_ratio_pct: 1.23 },
] };
const json = (data: unknown, code = 0) => Response.json({ code, message: 'test', data });
const make = (fetchImpl: typeof fetch, timeoutMs?: number) => new FuyaoHttpAdapter({
  baseUrl: 'https://fuyao.aicubes.cn', apiToken: 'test-key-not-real', fetchImpl, timeoutMs,
});

test('uses documented paths, X-api-key, exchange code and Shanghai millisecond window', async () => {
  const calls: URL[] = [];
  const adapter = make(async (input, init) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(new Headers(init?.headers).get('X-api-key'), 'test-key-not-real');
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    assert.equal(init?.redirect, 'error');
    return json(url.pathname.endsWith('historical') ? history : snapshot);
  });
  const data = await adapter.getKline('300750', '2026-10-08', '2026-10-16');
  assert.equal(calls[0].pathname, '/api/a-share/prices/historical');
  assert.equal(calls[0].searchParams.get('thscode'), '300750.SZ');
  assert.equal(calls[0].searchParams.get('interval'), '1d');
  assert.equal(calls[0].searchParams.get('adjust'), 'forward');
  assert.equal(calls[0].searchParams.get('start'), String(Date.parse('2026-10-08T00:00:00+08:00')));
  assert.equal(calls[0].searchParams.get('end'), String(Date.parse('2026-10-16T23:59:59.999+08:00')));
  assert.equal(calls[1].pathname, '/api/a-share/prices/snapshot');
  assert.equal(calls[1].searchParams.get('thscodes'), '300750.SZ');
  assert.equal(data.origin, 'fuyao');
  assert.equal(data.kline[0].date, '2026-10-16');
  assert.equal(data.kline[0].volume, 1234); // 股 → 手
  assert.equal(data.quote?.price, 103);
  assert.equal(data.quote?.pctChange, 1.23); // Already percent, not fraction.
  assert.deepEqual(data.warnings, []);
  await adapter.getKline('300750.SZ', '2026-10-08', '2026-10-16');
  assert.equal(calls.length, 2);
});

test('recognizes supported exchanges and rejects mismatches or placeholder subjects', () => {
  assert.equal(fuyaoStockCode('600519'), '600519.SH');
  assert.equal(fuyaoStockCode('000001.sz'), '000001.SZ');
  assert.equal(fuyaoStockCode('920001'), '920001.BJ');
  for (const code of ['600519.SZ', 'NAME-公司', '688XXX', '00700.HK', '../secret']) {
    assert.throws(() => fuyaoStockCode(code));
  }
});

test('missing config and invalid dates make no upstream requests', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return json(history); };
  const missing = new FuyaoHttpAdapter({ baseUrl: '', apiToken: '', fetchImpl });
  assert.equal(missing.isConfigured(), false);
  await assert.rejects(missing.getKline('300750', '2026-10-08', '2026-10-16'), /未配置/);
  const adapter = make(fetchImpl);
  for (const [start, end] of [['2026-02-30', '2026-03-01'], ['2026-10-20', '2026-10-16'], ['2000-01-01', '2026-01-01']]) {
    await assert.rejects(adapter.getKline('300750', start, end));
  }
  assert.equal(calls, 0);
});

test('HTTP 200 with business auth/permission/rate errors never masquerades as success', async () => {
  for (const code of [2001, 2003, 4001]) {
    await assert.rejects(make(async () => json({}, code)).getKline('300750', '2026-10-08', '2026-10-16'), new RegExp(String(code)));
  }
});

test('non-JSON, bad schemas and HTTP errors fail explicitly without exposing response text', async () => {
  for (const response of [new Response('private upstream text', {status: 503}), new Response('private upstream text'), Response.json({code: 0, data: {}})]) {
    await assert.rejects(make(async () => response.clone()).getKline('300750', '2026-10-08', '2026-10-16'), error => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /private upstream text/);
      return true;
    });
  }
});

test('partial failure keeps genuine data with a visible warning, never mock data', async () => {
  const data = await make(async input => String(input).includes('historical') ? json(history) : json({}, 2003))
    .getKline('300750', '2026-10-08', '2026-10-16');
  assert.equal(data.origin, 'fuyao');
  assert.equal(data.quote, null);
  assert.equal(data.kline.length, 1);
  assert.match(data.warnings[0], /快照不可用.*2003/);
});

test('empty data stays empty; null prices are not converted to zero', async () => {
  const data = await make(async input => json(String(input).includes('historical')
    ? {item: [{...history.item[0], close_price: null}]} : {timestamp: null, item: []}))
    .getKline('300750', '2026-10-08', '2026-10-16');
  assert.equal(data.origin, 'fuyao');
  assert.equal(data.kline.length, 0);
  assert.equal(data.quote, null);
  assert.ok(data.warnings.length > 0);
});

test('unrelated snapshot ticker cannot supply a quote', async () => {
  const data = await make(async input => json(String(input).includes('historical') ? history
    : {...snapshot, item: [{...snapshot.item[0], thscode: '600519.SH'}]}))
    .getKline('300750', '2026-10-08', '2026-10-16');
  assert.equal(data.quote, null);
});

test('requests have a timeout and error remains explicit', async () => {
  const adapter = make(async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  }), 5);
  await assert.rejects(adapter.getKline('300750', '2026-10-08', '2026-10-16'), /超时/);
});
