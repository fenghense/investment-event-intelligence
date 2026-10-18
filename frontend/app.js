/* ============================================================
 * 投资事件情报平台 · 纯前端版逻辑
 * 零依赖原生 JS：优先调用后端开放 API，失败时降级内置模拟数据。
 * ============================================================ */

/**
 * API 调用占位：
 * - 部署在本平台同源时：保持 '' 即可（请求 /api/*）。
 * - 部署到 GitHub Pages 等外部静态托管时：改为平台绝对地址，
 *   例如 'https://your-app.dev.coze.site'（后端已全局放开 CORS）。
 */
var API_BASE = '';

/** 词表（与后端 src/lib/domain/vocabulary.ts 对齐，禁止各处自定义） */
var STATUS_LABELS = {
  published: '初发布', updated: '有更新', corrected: '已更正',
  denied: '已否认', expired: '已过期', revived: '反转'
};
var SOURCE_LABELS = {
  announcement: '公告', exchange: '交易所', media: '权威媒体',
  research: '研报', official_social: '官方社媒', social: '社交媒体', personal: '个人传闻'
};
var EVIDENCE_TYPE_LABELS = { fact: '事实', opinion: '观点', speculation: '推测', rumor: '传闻' };
var ACTION_LABELS = {
  COOPERATE: '签署合作', INCREASE: '增持', REDUCE: '减持', ACQUISITION: '收购',
  SUBSCRIBE: '认购', TRANSFER: '转让', TERMINATE: '终止', PLEDGE: '质押',
  DENY: '澄清否认', OTHER: '动态'
};

/* ---------------- 模拟数据（API 不可用时降级展示） ---------------- */
var MOCK_EVENTS = [
  {
    id: 'EVT-MOCK-001',
    title: '宁德时代·与赛力斯签署合作',
    subject: '宁德时代', subjectCode: '300750', action: 'COOPERATE', object: '赛力斯',
    status: 'published', credibility: 'high',
    credibilityText: '高（3 条公告级证据支撑）',
    summary: '宁德时代与赛力斯签署长期战略合作协议，双方将在动力电池供应与智能电动车领域开展深度合作。',
    sourceType: 'announcement', evidenceCount: 3,
    updatedAt: '2026-10-17 18:00', disclosedAt: '2026-10-12 18:00',
    evidences: [
      { sourceName: '巨潮资讯网·法定信息披露', sourceType: 'announcement', evidenceType: 'fact', weight: 'high', title: '宁德时代：关于签署战略合作协议的公告', disclosedAt: '2026-10-17 18:00' },
      { sourceName: 'iFinD 实时新闻', sourceType: 'media', evidenceType: 'fact', weight: 'high', title: '宁德时代与赛力斯签署长期战略合作协议', disclosedAt: '2026-10-17 09:30' },
      { sourceName: '36氪快讯', sourceType: 'media', evidenceType: 'fact', weight: 'low', title: '宁德时代、赛力斯签约，问界继续全系搭载宁德时代电池', disclosedAt: '2026-10-12 18:00' }
    ]
  },
  {
    id: 'EVT-MOCK-002',
    title: '宁德时代·增持',
    subject: '宁德时代', subjectCode: '300750', action: 'INCREASE', object: '本公司股份',
    status: 'updated', credibility: 'high',
    credibilityText: '高（回购进展持续披露）',
    summary: '宁德时代回购方案持续推进：方案 → 进展 → 完成属同一事件演化节点，合并为一张卡片跟踪。',
    sourceType: 'announcement', evidenceCount: 4,
    updatedAt: '2026-10-16 19:00', disclosedAt: '2026-09-28 10:00',
    evidences: [
      { sourceName: '巨潮资讯网', sourceType: 'announcement', evidenceType: 'fact', weight: 'high', title: '关于回购公司股份的进展公告', disclosedAt: '2026-10-16 19:00' },
      { sourceName: 'iFinD 新闻', sourceType: 'media', evidenceType: 'fact', weight: 'high', title: '宁德时代：累计回购股份占总股本 0.8%', disclosedAt: '2026-10-10 12:00' }
    ]
  },
  {
    id: 'EVT-MOCK-003',
    title: '某半导体公司·澄清否认',
    subject: '某半导体公司', subjectCode: '688XXX', action: 'DENY', object: '股权转让传闻',
    status: 'denied', credibility: 'high',
    credibilityText: '高（公司公告正式否认）',
    summary: '针对社交媒体流传的股权转让传闻，公司发布澄清公告：不存在相关事宜，传闻严重不实。',
    sourceType: 'announcement', evidenceCount: 3,
    updatedAt: '2026-10-15 20:00', disclosedAt: '2026-10-14 13:00',
    evidences: [
      { sourceName: '巨潮资讯网', sourceType: 'announcement', evidenceType: 'fact', weight: 'high', title: '澄清公告：不存在股权转让事宜', disclosedAt: '2026-10-15 20:00' },
      { sourceName: '社交媒体传闻', sourceType: 'personal', evidenceType: 'rumor', weight: 'low', title: '网传某半导体公司即将易主（未坐实）', disclosedAt: '2026-10-14 13:00' }
    ]
  },
  {
    id: 'EVT-MOCK-004',
    title: '某新能源公司·收购',
    subject: '某新能源公司', subjectCode: '002XXX', action: 'ACQUISITION', object: '星辉数据',
    status: 'corrected', credibility: 'medium',
    credibilityText: '中（收购比例经公告更正：51% → 70%）',
    summary: '拟收购星辉数据股权，早期报道称 51%，后续正式公告更正为 70% 股权并取得控制权。',
    sourceType: 'announcement', evidenceCount: 2,
    updatedAt: '2026-10-13 17:00', disclosedAt: '2026-10-11 09:00',
    evidences: [
      { sourceName: '巨潮资讯网', sourceType: 'announcement', evidenceType: 'fact', weight: 'high', title: '关于收购星辉数据 70% 股权的公告（更正后）', disclosedAt: '2026-10-13 17:00' },
      { sourceName: '财经媒体早讯', sourceType: 'media', evidenceType: 'speculation', weight: 'low', title: '传某新能源公司拟控股星辉数据（早期口径 51%）', disclosedAt: '2026-10-11 09:00' }
    ]
  },
  {
    id: 'EVT-MOCK-005',
    title: '某消费公司·减持',
    subject: '某消费公司', subjectCode: '600XXX', action: 'REDUCE', object: '本公司股份',
    status: 'expired', credibility: 'medium',
    credibilityText: '中（减持计划期限届满）',
    summary: '大股东减持计划期限届满，累计减持 1.2%，该事件已过期归档。',
    sourceType: 'exchange', evidenceCount: 2,
    updatedAt: '2026-09-30 18:00', disclosedAt: '2026-08-15 10:00',
    evidences: [
      { sourceName: '交易所披露', sourceType: 'exchange', evidenceType: 'fact', weight: 'high', title: '股东减持计划期限届满暨实施结果公告', disclosedAt: '2026-09-30 18:00' }
    ]
  },
  {
    id: 'EVT-MOCK-006',
    title: '某医药公司·相关动态',
    subject: '某医药公司', subjectCode: null, action: 'OTHER', object: null,
    status: 'revived', credibility: 'low',
    credibilityText: '低（传闻反转，官方确认后复活）',
    summary: '此前被否认的合作传闻，经 ≥3 个独立高质量来源交叉验证并由官方确认，事件复活跟踪。',
    sourceType: 'media', evidenceCount: 5,
    updatedAt: '2026-10-18 09:00', disclosedAt: '2026-10-08 14:00',
    evidences: [
      { sourceName: '公司互动回复', sourceType: 'official_social', evidenceType: 'fact', weight: 'high', title: '官方确认：确在洽谈合作（事件复活）', disclosedAt: '2026-10-18 09:00' },
      { sourceName: '社交媒体传闻', sourceType: 'social', evidenceType: 'rumor', weight: 'low', title: '早期传闻（曾被否认，未坐实）', disclosedAt: '2026-10-08 14:00' }
    ]
  }
];

/* ---------------- 数据访问层：真实 API 优先，模拟数据兜底 ---------------- */

function fetchEvents(query) {
  var url = API_BASE + '/api/search?q=' + encodeURIComponent(query || '');
  return fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(function (data) {
      var list = (data && data.events) || [];
      if (!list.length) throw new Error('empty');
      return { origin: 'remote', events: list.map(normalizeEvent) };
    })
    .catch(function () {
      // 降级：模拟数据本地过滤
      var q = (query || '').trim();
      var filtered = !q ? MOCK_EVENTS : MOCK_EVENTS.filter(function (e) {
        return (e.title + e.subject + (e.summary || '')).indexOf(q) >= 0;
      });
      return { origin: 'mock', events: filtered };
    });
}

/** 后端事件结构 → 前端渲染结构（字段容错映射） */
function normalizeEvent(e) {
  var evs = e.evidences || [];
  return {
    id: e.id,
    title: e.title,
    subject: e.subject, subjectCode: e.subjectCode,
    action: e.action, object: e.object,
    status: e.status || 'published',
    credibility: e.credibility || 'medium',
    credibilityText: e.credibilityText || '',
    summary: e.summary || '',
    sourceType: (evs[0] && evs[0].sourceType) || e.sourceType || 'media',
    evidenceCount: (e.evidenceIds && e.evidenceIds.length) || evs.length || e.evidenceCount || 0,
    updatedAt: fmtTime(e.updatedAt), disclosedAt: fmtTime(e.disclosedAt || e.createdAt),
    evidences: evs.map(function (ev) {
      return {
        sourceName: ev.sourceName || '', sourceType: ev.sourceType || 'media',
        evidenceType: ev.evidenceType || 'fact',
        weight: (ev.weight && ev.weight.total >= 60) ? 'high' : (ev.weight ? 'low' : (ev.weight || 'high')),
        title: ev.title || '', disclosedAt: fmtTime(ev.disclosedAt)
      };
    })
  };
}

function fmtTime(t) {
  if (!t) return '';
  var d = new Date(t);
  if (isNaN(d.getTime())) return String(t).slice(0, 16);
  function p(n) { return n < 10 ? '0' + n : '' + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/* ---------------- 渲染层 ---------------- */

var elCards = document.getElementById('event-cards');
var elLoading = document.getElementById('loading');
var elEmpty = document.getElementById('empty');
var elMeta = document.getElementById('result-meta');
var elOrigin = document.getElementById('result-origin');
var elApiStatus = document.getElementById('api-status');

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function render(list, origin, query) {
  elLoading.hidden = true;
  if (!list.length) {
    elCards.innerHTML = '';
    elEmpty.hidden = false;
    elMeta.textContent = '';
    elOrigin.textContent = '';
    return;
  }
  elEmpty.hidden = true;
  elMeta.textContent = '共 ' + list.length + ' 个事件' + (query ? ' · 关键词「' + query + '」' : '');
  elOrigin.textContent = origin === 'remote' ? '数据源：实时 API' : '数据源：内置演示数据（API 未连通）';
  elApiStatus.textContent = origin === 'remote' ? 'API 已连接' : '演示数据模式';
  elApiStatus.className = 'api-status ' + (origin === 'remote' ? 'ok' : 'mock');

  elCards.innerHTML = list.map(function (e) {
    var isRumorOnly = e.evidences.length && e.evidences.every(function (ev) { return ev.evidenceType === 'rumor'; });
    return '' +
      '<article class="event-card" data-src="' + escapeHtml(e.sourceType) + '" data-id="' + escapeHtml(e.id) + '">' +
        '<div class="event-head">' +
          '<span class="event-title">' + escapeHtml(e.title) + '</span>' +
          '<span class="status-chip status-' + escapeHtml(e.status) + '">' + escapeHtml(STATUS_LABELS[e.status] || e.status) + '</span>' +
          (isRumorOnly ? '<span class="chip-rumor">传闻未坐实</span>' : '') +
          (e.credibilityText ? '<span class="credibility">' + escapeHtml(e.credibilityText) + '</span>' : '') +
        '</div>' +
        '<p class="event-summary">' + escapeHtml(e.summary) + '</p>' +
        '<div class="event-foot">' +
          '<span class="ev-count">证据 ' + e.evidenceCount + ' 条</span>' +
          '<span>主体 ' + escapeHtml(e.subject) + (e.subjectCode ? '（' + escapeHtml(e.subjectCode) + '）' : '') + '</span>' +
          '<span>更新 ' + escapeHtml(e.updatedAt) + '</span>' +
        '</div>' +
      '</article>';
  }).join('');

  Array.prototype.forEach.call(elCards.querySelectorAll('.event-card'), function (card) {
    card.addEventListener('click', function () {
      var id = card.getAttribute('data-id');
      var ev = null;
      for (var i = 0; i < currentList.length; i++) {
        if (currentList[i].id === id) { ev = currentList[i]; break; }
      }
      if (ev) openDetail(ev);
    });
  });
}

function openDetail(e) {
  var body = document.getElementById('detail-body');
  var high = e.evidences.filter(function (ev) { return ev.weight !== 'low'; });
  var low = e.evidences.filter(function (ev) { return ev.weight === 'low'; });

  function evItem(ev, isLow) {
    return '' +
      '<div class="evidence-item' + (isLow ? ' low' : '') + '">' +
        '<div class="evidence-head">' +
          '<span class="evidence-src">' + escapeHtml(ev.sourceName) + '</span>' +
          '<span class="evidence-type et-' + escapeHtml(ev.evidenceType) + '">' + escapeHtml(EVIDENCE_TYPE_LABELS[ev.evidenceType] || ev.evidenceType) + '</span>' +
          '<span class="status-chip" style="color:var(--ink-3);background:#F3F4F6;border-color:var(--line)">' + escapeHtml(SOURCE_LABELS[ev.sourceType] || ev.sourceType) + '</span>' +
        '</div>' +
        '<div class="evidence-title">' + escapeHtml(ev.title) + '</div>' +
        '<div class="evidence-time">披露 ' + escapeHtml(ev.disclosedAt) + '</div>' +
      '</div>';
  }

  body.innerHTML = '' +
    '<h2 class="detail-title">' + escapeHtml(e.title) + '</h2>' +
    '<div class="detail-sub">' +
      '<span class="status-chip status-' + escapeHtml(e.status) + '">' + escapeHtml(STATUS_LABELS[e.status] || e.status) + '</span>' +
      '<span class="credibility">' + escapeHtml(e.credibilityText) + '</span>' +
    '</div>' +
    '<div class="detail-section"><h3>摘要</h3><p>' + escapeHtml(e.summary) + '</p></div>' +
    '<div class="detail-section"><h3>证据时间线（高权重 ' + high.length + ' 条）</h3>' +
      (high.map(function (ev) { return evItem(ev, false); }).join('') || '<p style="color:var(--ink-3)">暂无</p>') +
    '</div>' +
    (low.length
      ? '<div class="detail-section"><h3>低权重证据（' + low.length + ' 条，谨慎采信）</h3>' +
        low.map(function (ev) { return evItem(ev, true); }).join('') + '</div>'
      : '') +
    '<div class="detail-section"><h3>要素</h3>' +
      '<p style="font-family:var(--font-mono);font-size:12px;color:var(--ink-2)">' +
      '主体 ' + escapeHtml(e.subject) + (e.subjectCode ? '（' + escapeHtml(e.subjectCode) + '）' : '') +
      ' · 动作 ' + escapeHtml(ACTION_LABELS[e.action] || e.action) +
      (e.object ? ' · 对象 ' + escapeHtml(e.object) : '') +
      ' · 首次披露 ' + escapeHtml(e.disclosedAt) +
      '</p></div>';

  document.getElementById('detail-mask').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDetail() {
  document.getElementById('detail-mask').hidden = true;
  document.body.style.overflow = '';
}

/* ---------------- 交互绑定 ---------------- */

var currentList = [];

function doSearch(q) {
  elLoading.hidden = false;
  elCards.innerHTML = '';
  elEmpty.hidden = true;
  fetchEvents(q).then(function (r) {
    currentList = r.events;
    render(r.events, r.origin, q);
  });
}

document.getElementById('search-form').addEventListener('submit', function (ev) {
  ev.preventDefault();
  doSearch(document.getElementById('search-input').value.trim());
});

document.getElementById('detail-close').addEventListener('click', closeDetail);
document.getElementById('detail-mask').addEventListener('click', function (ev) {
  if (ev.target === this) closeDetail();
});
document.addEventListener('keydown', function (ev) {
  if (ev.key === 'Escape') closeDetail();
});

/* 热门标签：来自模拟数据中的真实主体（演示版静态取前 4 个） */
(function renderHotTags() {
  var names = [];
  MOCK_EVENTS.forEach(function (e) {
    if (names.indexOf(e.subject) < 0) names.push(e.subject);
  });
  var box = document.getElementById('hot-tags');
  box.innerHTML = names.slice(0, 4).map(function (n) {
    return '<button type="button" class="hot-tag" data-q="' + escapeHtml(n) + '">' + escapeHtml(n) + '</button>';
  }).join('');
  Array.prototype.forEach.call(box.querySelectorAll('.hot-tag'), function (tag) {
    tag.addEventListener('click', function () {
      var q = tag.getAttribute('data-q');
      document.getElementById('search-input').value = q;
      doSearch(q);
    });
  });
})();

/* 首屏：加载全量（实时 API 可用时返回真实事件） */
doSearch('');
