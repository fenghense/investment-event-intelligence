// ============================================
// Investment Event Intelligence - 前端逻辑
// ============================================

// API 配置 - 替换为扣子发布的实际 API 地址
const API_CONFIG = {
    COZE_API_BASE: 'https://api.coze.cn/v1',  // 扣子 API 地址
    EVENT_SEARCH_ENDPOINT: '/v1/event/search',
    EVENT_TIMELINE_ENDPOINT: '/v1/event/timeline',
    EVENT_ANALYSIS_ENDPOINT: '/v1/event/analysis',
    FUYAO_API_BASE: 'https://api.fuyao.com/v1',  // 扶摇 API 地址
    IFIND_API_BASE: 'https://api.ifind.com/v1',   // iFinD MCP API 地址
};

// ============================================
// 模拟数据（演示用，实际使用时替换为 API 调用）
// ============================================
const MOCK_DATA = {
    event: {
        id: 'EVT-2026-001',
        title: '平安银行(000001)拟收购深圳某金融科技公司的股权',
        description: '据多方信息显示，平安银行拟收购深圳某金融科技公司的控股权，该事件已在公告、新闻、研报等多个信息源中持续演化。本产品通过 AI 自动采集、去重、分级，帮助用户看清事件全貌。',
        status: 'active',
        sourceCount: 8,
        lastUpdate: '2026-10-17 14:30:00',
    },
    timeline: [
        {
            id: 'node-1',
            type: 'rumor',
            source: '市场传闻',
            title: '市场传闻：平安银行拟收购某金融科技公司',
            time: '2026-09-15 09:30',
            timestampType: 'rumor-time',
            content: '有市场传闻称平安银行正在考虑收购深圳某金融科技公司的控股权，但尚未得到官方确认。该传闻在社交媒体和投资群中广泛传播。',
            evidenceLevel: 'low',
            factType: '传闻',
            conflictWith: ['node-3'],
        },
        {
            id: 'node-2',
            type: 'news',
            source: '财经新闻',
            title: '媒体报道：平安银行疑似布局金融科技领域收购',
            time: '2026-09-20 16:45',
            timestampType: 'disclosure',
            content: '多家财经媒体报道称，平安银行正在积极布局金融科技领域，可能有重大收购动作。报道引用了匿名知情人士的消息。',
            evidenceLevel: 'medium',
            factType: '观点',
            conflictWith: [],
        },
        {
            id: 'node-3',
            type: 'announcement',
            source: '公司公告',
            title: '平安银行发布停牌公告',
            time: '2026-10-08 08:00',
            timestampType: 'disclosure',
            content: '平安银行(000001)发布公告，因正在筹划重大事项，公司股票自2026年10月8日起停牌。公告未明确说明事项具体内容。',
            evidenceLevel: 'high',
            factType: '事实',
            conflictWith: [],
        },
        {
            id: 'node-4',
            type: 'announcement',
            source: '交易所公告',
            title: '平安银行披露重大资产重组预案',
            time: '2026-10-12 18:00',
            timestampType: 'disclosure',
            content: '平安银行发布重大资产重组预案公告，拟通过增资扩股方式引入战略投资者，涉及金额不超过50亿元。公告确认了收购事宜但细节与前期传闻有所出入。',
            evidenceLevel: 'high',
            factType: '事实',
            conflictWith: ['node-1'],
            statusChange: 'update',
        },
        {
            id: 'node-5',
            type: 'research',
            source: '券商研报',
            title: '中信证券：平安银行收购案对估值有正面影响',
            time: '2026-10-13 10:00',
            timestampType: 'capture',
            content: '中信证券发布研报认为，平安银行此次收购符合其金融科技战略方向，预计对中长期估值有正面影响，但短期需关注整合风险。维持"买入"评级。',
            evidenceLevel: 'medium',
            factType: '观点',
            conflictWith: [],
        },
        {
            id: 'node-6',
            type: 'news',
            source: '财经新闻',
            title: '平安银行收购标的方否认此前传闻细节',
            time: '2026-10-15 11:30',
            timestampType: 'update',
            content: '据媒体报道，被收购方某金融科技公司发布声明，否认此前市场关于收购价格等细节的传闻，称相关报道与事实不符。',
            evidenceLevel: 'medium',
            factType: '更正',
            conflictWith: ['node-1', 'node-2'],
            statusChange: 'deny',
        },
        {
            id: 'node-7',
            type: 'research',
            source: '券商研报',
            title: '中金公司：需关注收购整合风险',
            time: '2026-10-16 14:00',
            timestampType: 'capture',
            content: '中金公司发布研报指出，虽然收购战略方向正确，但需关注跨行业整合风险及商誉减值风险。建议投资者关注后续进展。',
            evidenceLevel: 'medium',
            factType: '观点',
            conflictWith: [],
        },
        {
            id: 'node-8',
            type: 'announcement',
            source: '公司公告',
            title: '平安银行：股票将于10月18日复牌',
            time: '2026-10-17 14:30',
            timestampType: 'disclosure',
            content: '平安银行发布公告，公司股票将于2026年10月18日开市起复牌。复牌后首个交易日不设置涨跌幅限制。',
            evidenceLevel: 'high',
            factType: '事实',
            conflictWith: [],
            statusChange: 'update',
        },
    ],
    analysis: {
        entities: [
            { name: '平安银行(000001)', relation: '收购方', impact: 'positive' },
            { name: '某金融科技公司', relation: '被收购方', impact: 'neutral' },
            { name: '金融科技板块', relation: '所属行业', impact: 'positive' },
            { name: '银行板块', relation: '关联行业', impact: 'neutral' },
        ],
        marketImpact: {
            preEventPrice: '12.50',
            currentPrice: '13.80',
            changePercent: '+10.4%',
            volumeChange: '成交量放大230%',
            analysis: '停牌前股价为12.50元，复牌预期较强。市场对该收购案整体持正面态度，金融科技板块同步上涨。但需关注复牌后实际走势与预期是否一致。',
        },
        conflicts: [
            {
                description: '市场传闻称收购价格为30亿元，但正式公告披露不超过50亿元增资扩股',
                sources: ['市场传闻', '公司公告'],
                severity: 'medium',
            },
            {
                description: '早期报道引用匿名人士称收购标的为某支付公司，后公告确认为金融科技公司',
                sources: ['财经新闻', '公司公告'],
                severity: 'low',
            },
        ],
    },
};

// ============================================
// 页面元素引用
// ============================================
const elements = {
    searchInput: document.getElementById('searchInput'),
    searchBtn: document.getElementById('searchBtn'),
    loadingState: document.getElementById('loadingState'),
    timelineView: document.getElementById('timelineView'),
    analysisView: document.getElementById('analysisView'),
    aboutView: document.getElementById('aboutView'),
    timeline: document.getElementById('timeline'),
    eventTitle: document.getElementById('eventTitle'),
    eventStatus: document.getElementById('eventStatus'),
    eventDescription: document.getElementById('eventDescription'),
    eventId: document.getElementById('eventId'),
    sourceCount: document.getElementById('sourceCount'),
    lastUpdate: document.getElementById('lastUpdate'),
    entityLinks: document.getElementById('entityLinks'),
    marketImpact: document.getElementById('marketImpact'),
    conflictDetection: document.getElementById('conflictDetection'),
    navLinks: document.querySelectorAll('.nav-link'),
    hintTags: document.querySelectorAll('.hint-tag'),
};

// ============================================
// 页面切换逻辑
// ============================================
function switchPage(pageName) {
    // 更新导航状态
    elements.navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.dataset.page === pageName) {
            link.classList.add('active');
        }
    });

    // 切换视图
    elements.timelineView.classList.add('hidden');
    elements.analysisView.classList.add('hidden');
    elements.aboutView.classList.add('hidden');

    if (pageName === 'timeline') {
        elements.timelineView.classList.remove('hidden');
    } else if (pageName === 'analysis') {
        elements.analysisView.classList.remove('hidden');
    } else if (pageName === 'about') {
        elements.aboutView.classList.remove('hidden');
    }
}

// 导航事件绑定
elements.navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        switchPage(link.dataset.page);
    });
});

// ============================================
// 搜索功能
// ============================================
function handleSearch(query) {
    if (!query.trim()) return;

    // 显示加载状态
    elements.loadingState.classList.remove('hidden');
    elements.timelineView.classList.add('hidden');
    elements.analysisView.classList.add('hidden');

    // 模拟 API 调用延迟
    setTimeout(() => {
        // 实际使用时替换为真实 API 调用：
        // fetch(API_CONFIG.COZE_API_BASE + API_CONFIG.EVENT_SEARCH_ENDPOINT, {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ query: query })
        // })
        // .then(response => response.json())
        // .then(data => renderTimeline(data))
        // .catch(error => handleError(error));

        // 使用模拟数据渲染
        renderTimeline(MOCK_DATA);
        renderAnalysis(MOCK_DATA.analysis);
        
        elements.loadingState.classList.add('hidden');
        elements.timelineView.classList.remove('hidden');
    }, 1500);
}

// 搜索按钮事件
elements.searchBtn.addEventListener('click', () => {
    handleSearch(elements.searchInput.value);
});

// 回车键搜索
elements.searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleSearch(elements.searchInput.value);
    }
});

// 热门搜索标签
elements.hintTags.forEach(tag => {
    tag.addEventListener('click', () => {
        elements.searchInput.value = tag.dataset.query;
        handleSearch(tag.dataset.query);
    });
});

// ============================================
// 渲染时间线
// ============================================
function renderTimeline(data) {
    const { event, timeline } = data;

    // 更新事件概览
    elements.eventTitle.textContent = event.title;
    elements.eventStatus.textContent = getStatusText(event.status);
    elements.eventStatus.className = 'status-badge status-' + event.status;
    elements.eventDescription.textContent = event.description;
    elements.eventId.textContent = event.id;
    elements.sourceCount.textContent = event.sourceCount;
    elements.lastUpdate.textContent = event.lastUpdate;

    // 渲染时间线节点
    elements.timeline.innerHTML = '';
    timeline.forEach((node, index) => {
        const nodeEl = createTimelineNode(node, index);
        elements.timeline.appendChild(nodeEl);
    });
}

function createTimelineNode(node, index) {
    const div = document.createElement('div');
    div.className = 'timeline-node type-' + node.type;
    div.style.animationDelay = (index * 0.1) + 's';

    const sourceClass = 'source-' + node.type;
    const evidenceClass = node.evidenceLevel;
    const conflictHtml = node.conflictWith && node.conflictWith.length > 0
        ? '<span class="conflict-indicator">&#9888; 存在证据冲突(' + node.conflictWith.length + '处)</span>'
        : '';
    
    const statusChangeHtml = node.statusChange
        ? '<span class="status-change-badge status-' + node.statusChange + '">状态变更：' + getStatusChangeText(node.statusChange) + '</span>'
        : '';

    div.innerHTML = `
        <div class="timeline-card">
            <div class="timeline-header">
                <div class="timeline-source">
                    <span class="source-badge ${sourceClass}">${node.source}</span>
                    <span class="timeline-title">${node.title}</span>
                </div>
                <span class="timeline-time">${node.time}</span>
            </div>
            <div class="timeline-body">
                ${node.content}
            </div>
            <div class="timeline-footer">
                <div class="evidence-tags">
                    <span class="evidence-tag ${evidenceClass}">证据权重：${getEvidenceText(node.evidenceLevel)}</span>
                    <span class="evidence-tag">${node.factType}</span>
                    <span class="evidence-tag">${getTimestampTypeText(node.timestampType)}</span>
                </div>
                <div>
                    ${statusChangeHtml}
                    ${conflictHtml}
                </div>
            </div>
        </div>
    `;

    return div;
}

// ============================================
// 渲染分析面板
// ============================================
function renderAnalysis(data) {
    // 标的关联
    elements.entityLinks.innerHTML = data.entities.map(entity => `
        <div class="entity-item">
            <div>
                <span class="entity-name">${entity.name}</span>
                <div class="entity-relation">${entity.relation}</div>
            </div>
            <span class="impact-${entity.impact}">${getImpactText(entity.impact)}</span>
        </div>
    `).join('');

    // 市场影响
    const impact = data.marketImpact;
    elements.marketImpact.innerHTML = `
        <div class="entity-item">
            <span>停牌前股价</span>
            <span>${impact.preEventPrice} 元</span>
        </div>
        <div class="entity-item">
            <span>预期复牌价</span>
            <span>${impact.currentPrice} 元</span>
        </div>
        <div class="entity-item">
            <span>预期涨幅</span>
            <span class="impact-${impact.changePercent.includes('+') ? 'positive' : 'negative'}">${impact.changePercent}</span>
        </div>
        <div class="entity-item">
            <span>成交量变化</span>
            <span>${impact.volumeChange}</span>
        </div>
        <p style="margin-top: 12px; color: var(--text-secondary); font-size: 13px; line-height: 1.7;">
            ${impact.analysis}
        </p>
    `;

    // 证据冲突
    elements.conflictDetection.innerHTML = data.conflicts.length > 0
        ? data.conflicts.map(conflict => `
            <div class="conflict-item" style="background: var(--bg-card-hover); border-radius: 8px; padding: 16px; margin-bottom: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                    <span style="color: var(--text-primary); font-weight: 500;">${conflict.description}</span>
                    <span class="evidence-tag ${conflict.severity}">严重程度：${conflict.severity === 'high' ? '高' : conflict.severity === 'medium' ? '中' : '低'}</span>
                </div>
                <div style="color: var(--text-muted); font-size: 12px;">
                    涉及来源：${conflict.sources.join('、')}
                </div>
            </div>
        `).join('')
        : '<p class="placeholder-text">未发现明显证据冲突</p>';
}

// ============================================
// 辅助函数
// ============================================
function getStatusText(status) {
    const map = {
        'active': '进行中',
        'updated': '已更新',
        'denied': '已否认',
        'expired': '已过期',
    };
    return map[status] || status;
}

function getStatusChangeText(change) {
    const map = {
        'update': '更新',
        'deny': '否认',
        'correct': '更正',
        'expire': '过期',
    };
    return map[change] || change;
}

function getEvidenceText(level) {
    const map = {
        'high': '高',
        'medium': '中',
        'low': '低',
    };
    return map[level] || level;
}

function getTimestampTypeText(type) {
    const map = {
        'event-time': '事件发生时间',
        'disclosure': '披露时间',
        'capture': '抓取时间',
        'update': '更新时间',
        'rumor-time': '传闻时间',
    };
    return map[type] || type;
}

function getImpactText(impact) {
    const map = {
        'positive': '正面影响',
        'negative': '负面影响',
        'neutral': '中性',
    };
    return map[impact] || impact;
}

function handleError(error) {
    console.error('API 调用失败:', error);
    elements.loadingState.classList.add('hidden');
    alert('数据加载失败，请检查网络连接或稍后重试。\n错误信息：' + error.message);
}

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    console.log('Investment Event Intelligence 已初始化');
    console.log('API 配置:', API_CONFIG);
    
    // 默认显示时间线页面
    switchPage('timeline');
    
    // 自动填充搜索框并搜索（演示用）
    elements.searchInput.value = '000001';
});
