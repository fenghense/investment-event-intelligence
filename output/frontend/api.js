(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EventApi = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createClient(options) {
    var base = String(options.baseUrl || '').trim().replace(/\/+$/, '');
    var fetchImpl = options.fetchImpl || function (url, init) { return fetch(url, init); };
    var timeoutMs = options.timeoutMs || 90000;

    function request(path) {
      if (!base) return Promise.reject(new Error('尚未配置后端地址'));
      try {
        var parsed = new URL(base);
        if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
          throw new Error('invalid');
        }
      } catch (_) {
        return Promise.reject(new Error('后端地址配置无效，请填写公开的 HTTPS 地址'));
      }
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
      return Promise.resolve().then(function () {
        return fetchImpl(base + path, {
          headers: { Accept: 'application/json' },
          signal: controller.signal
        });
      }).then(function (res) {
        if (!res.ok) throw new Error('后端返回 HTTP ' + res.status);
        if (!(res.headers.get('content-type') || '').includes('application/json')) {
          throw new Error('后端没有返回 JSON，请确认部署已完成且接口未被登录页拦截');
        }
        return res.json();
      }).catch(function (error) {
        if (controller.signal.aborted) throw new Error('后端响应超时，免费服务可能正在唤醒，请稍后重试');
        throw error;
      }).finally(function () { clearTimeout(timer); });
    }

    return {
      configured: Boolean(base),
      search: function (query) {
        var q = (query || '').trim();
        var path = q ? '/api/search?live=1&q=' + encodeURIComponent(q) : '/api/events';
        return request(path).then(function (data) {
          if (!data || !Array.isArray(data.events)) throw new Error('后端事件列表格式不正确');
          return data;
        });
      },
      detail: function (id) {
        return request('/api/events/' + encodeURIComponent(id)).then(function (data) {
          if (!data || !data.event || !Array.isArray(data.evidence)) throw new Error('后端事件详情格式不正确');
          return data;
        });
      }
    };
  }

  return { createClient: createClient };
});
