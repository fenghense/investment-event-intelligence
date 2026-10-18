const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createClient } = require('../frontend/api.js');

function response(data, status = 200, contentType = 'application/json') {
  return { ok: status < 400, status, headers: { get: () => contentType }, json: async () => data };
}

test('homepage uses events endpoint and preserves a valid empty result', async () => {
  const urls = [];
  const client = createClient({ baseUrl: 'https://api.example.com/', fetchImpl: async url => {
    urls.push(url);
    return response({ events: [] });
  } });
  assert.deepEqual(await client.search(''), { events: [] });
  assert.deepEqual(urls, ['https://api.example.com/api/events']);
});

test('search requests live ingestion and encodes the keyword', async () => {
  let request;
  const report = { sources: [{ key: 'ifind', status: 'empty', count: 0 }] };
  const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl: async (url, init) => {
    request = { url, init };
    return response({ events: [], live: report });
  } });
  const result = await client.search(' 宁德时代 & A ');
  assert.equal(request.url, 'https://api.example.com/api/search?live=1&q=' + encodeURIComponent('宁德时代 & A'));
  assert.deepEqual(result.live, report);
  assert.deepEqual(request.init.headers, { Accept: 'application/json' });
});

test('detail loads evidence from its dedicated endpoint', async () => {
  let url;
  const expected = { event: { id: 'EVT/1' }, evidence: [{ title: '公告' }] };
  const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl: async value => {
    url = value;
    return response(expected);
  } });
  assert.deepEqual(await client.detail('EVT/1'), expected);
  assert.equal(url, 'https://api.example.com/api/events/EVT%2F1');
});

test('HTTP failures, HTML login pages, malformed data and network errors reject', async () => {
  for (const fetchImpl of [
    async () => response({}, 503),
    async () => response({}, 200, 'text/html'),
    async () => response({ unexpected: [] }),
    async () => { throw new TypeError('network unavailable'); }
  ]) {
    const client = createClient({ baseUrl: 'https://api.example.com', fetchImpl });
    await assert.rejects(client.search('宁德时代'));
  }
});

test('unconfigured or invalid base URLs never send a request', async () => {
  let calls = 0;
  for (const baseUrl of ['', 'javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com?token=value']) {
    const client = createClient({ baseUrl, fetchImpl: async () => { calls++; return response({ events: [] }); } });
    await assert.rejects(client.search('x'));
  }
  assert.equal(calls, 0);
});

test('slow requests abort with a cold-start explanation', async () => {
  const client = createClient({ baseUrl: 'https://api.example.com', timeoutMs: 5,
    fetchImpl: (_url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    })
  });
  await assert.rejects(client.search('x'), /唤醒/);
});

function loadApp(client) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      hidden: true, innerHTML: '', textContent: '', className: '', value: '',
      addEventListener() {}, querySelectorAll() { return []; }
    });
    return elements.get(id);
  }
  const context = vm.createContext({
    window: { APP_CONFIG: { apiBase: 'https://api.example.com' } },
    document: { getElementById: element, addEventListener() {}, body: { style: {} } },
    EventApi: { createClient: () => client },
    Promise, Date, setTimeout, clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/app.js'), 'utf8'), context);
  return { context, element };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('an empty API response stays empty and still reports API connected', async () => {
  const { element, context } = loadApp({ configured: true, search: async () => ({ events: [] }) });
  await settle();
  assert.equal(context.currentList.length, 0);
  assert.equal(element('empty').hidden, false);
  assert.equal(element('api-error').hidden, true);
  assert.equal(element('api-status').textContent, 'API 已连接');
});

test('an API failure shows an error, not mock events', async () => {
  const { element, context } = loadApp({ configured: true, search: async () => { throw new Error('network'); } });
  await settle();
  assert.equal(context.currentList.length, 0);
  assert.equal(element('api-error').hidden, false);
  assert.equal(element('event-cards').innerHTML, '');
  assert.equal(element('api-status').textContent, 'API 连接失败');
});

test('only an explicitly unconfigured app displays offline demo events', async () => {
  const { context, element } = loadApp({ configured: false, search: () => { throw new Error('must not call'); } });
  await settle();
  assert.equal(context.currentList.length, 6);
  assert.equal(element('api-status').textContent, '演示数据模式');
  assert.equal(element('detail-mask').hidden, true);
});

test('a stale search cannot replace newer results', async () => {
  const pending = [];
  const { context } = loadApp({ configured: true, search: () => new Promise(resolve => pending.push(resolve)) });
  context.doSearch('new');
  pending[1]({ events: [{ id: 'new', title: '新结果' }] });
  await settle();
  pending[0]({ events: [{ id: 'old', title: '旧结果' }] });
  await settle();
  assert.equal(context.currentList[0].id, 'new');
});

test('closing a loading detail prevents it from reopening after the response', async () => {
  let resolveDetail;
  const { context, element } = loadApp({
    configured: true,
    search: async () => ({ events: [{ id: 'EVT-1' }] }),
    detail: () => new Promise(resolve => { resolveDetail = resolve; })
  });
  await settle();
  context.openDetail(context.currentList[0]);
  assert.equal(element('detail-mask').hidden, false);
  context.closeDetail();
  resolveDetail({ event: { id: 'EVT-1' }, evidence: [] });
  await settle();
  assert.equal(element('detail-mask').hidden, true);
});
