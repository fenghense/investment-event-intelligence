# 项目上下文

### 版本技术栈

- **Framework**: Next.js 16 (App Router)
- **Core**: React 19
- **Language**: TypeScript 5
- **UI 组件**: shadcn/ui (基于 Radix UI)
- **Styling**: Tailwind CSS 4

## 目录结构

```
├── public/                 # 静态资源
├── scripts/                # 构建与启动脚本
│   ├── build.sh            # 构建脚本
│   ├── dev.sh              # 开发环境启动脚本
│   ├── prepare.sh          # 预处理脚本
│   └── start.sh            # 生产环境启动脚本
├── src/
│   ├── app/                # 页面路由与布局
│   ├── components/ui/      # Shadcn UI 组件库
│   ├── hooks/              # 自定义 Hooks
│   ├── lib/                # 工具库
│   │   └── utils.ts        # 通用工具函数 (cn)
│   └── server.ts           # 自定义服务端入口
├── next.config.ts          # Next.js 配置
├── package.json            # 项目依赖管理
└── tsconfig.json           # TypeScript 配置
```

- 项目文件（如 app 目录、pages 目录、components 等）默认初始化到 `src/` 目录下。

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

### next.config 配置规范

- 配置的路径不要写死绝对路径，必须使用 path.resolve(__dirname, ...)、import.meta.dirname 或 process.cwd() 动态拼接。

### Hydration 问题防范

1. 严禁在 JSX 渲染逻辑中直接使用 typeof window、Date.now()、Math.random() 等动态数据。**必须使用 'use client' 并配合 useEffect + useState 确保动态内容仅在客户端挂载后渲染**；同时严禁非法 HTML 嵌套（如 <p> 嵌套 <div>）。
2. **禁止使用 head 标签**，优先使用 metadata，详见文档：https://nextjs.org/docs/app/api-reference/functions/generate-metadata
   1. 三方 CSS、字体等资源可在 `globals.css` 中顶部通过 `@import` 引入或使用 next/font
   2. preload, preconnect, dns-prefetch 通过 ReactDOM 的 preload、preconnect、dns-prefetch 方法引入
   3. json-ld 可阅读 https://nextjs.org/docs/app/guides/json-ld

## UI 设计与组件规范 (UI & Styling Standards)

- 模板默认预装核心组件库 `shadcn/ui`，位于`src/components/ui/`目录下
- Next.js 项目**必须默认**采用 shadcn/ui 组件、风格和规范，**除非用户指定用其他的组件和规范。**
- 本项目视觉规范（纸面核查工作台风格、印章式状态徽章、等宽数字）见 `DESIGN.md`，改 UI 前必读。

## 领域架构（投资事件情报平台）

核心主链路：证据 → 要素抽取 → 去重合并 → 状态机演化 → 通知。纯函数领域层与服务端存储分离：

```
src/lib/
├── domain/                  # 纯函数领域层（无 IO，可单测）
│   ├── types.ts             # 全部领域类型（Evidence/InvestmentEvent/AppNotification 等）
│   ├── vocabulary.ts        # 受控词表与标签（动作/状态/来源类型/证据类型，前后端共用）
│   ├── extract.ts           # 要素抽取：RuleExtractor（默认）+ LlmExtractor（coze-coding-dev-sdk，含提示词）
│   ├── dedup.ts             # dedup_key 生成(usableCode 拦截 NAME-/ENT- 兜底码防同事件分裂)、动作组归并、objectBridge 对象互补合并、相似度与候选匹配
│   ├── scoring.ts           # 证据权重六要素评分 + 事件可信度分级
│   └── stateMachine.ts      # 合法转换表 + 复活门槛（官方确认 或 ≥3 独立高质量来源）
├── adapters/
│   ├── sourceAdapter.ts    # SourceAdapter 接口 + MockAdapter + 巨潮/Tushare 骨架
│   ├── ifind/              # 同花顺 iFinD MCP 真实数据源（Streamable HTTP）
│   │   ├── mcpClient.ts    # JSON-RPC 客户端：会话(mcp-session-id)/≥1s限流/指数退避重试/SSE解析/调用计数
│   │   └── adapter.ts      # IfindSourceAdapter：search_notice+search_news 字段映射、缓存(公告24h/新闻12h)、降级链
│   └── fuyao/
│       ├── httpAdapter.ts   # 扶摇真实 REST：X-api-key、快照/日K、业务码校验、字段与单位转换
│       └── marketAdapter.ts # MarketDataAdapter 接口 + 适配器选择 + MockMarketAdapter + computeImpact
├── workflows/               # Agent 工作流（节点化，每节点产出 WorkflowNodeTrace 轨迹）
│   ├── types.ts             # WorkflowNodeTrace/WorkflowWarning + timed/timedAsync + callLlmJson(LLM JSON 调用)
│   ├── w1Ingestion.ts       # W1 事件采集与去重：数据采集→规则抽取→dedup 聚类→LLM 实体链接(并查集合并，≤5 对/次)
│   ├── w2Grading.ts         # W2 证据分级与时间线：来源 T1 公告级>T2 研报级>T3 媒体级>T4 社媒级 + credibilityText
│   ├── w3Evolution.ts       # W3 版本演化：演化图(supplement/correction/overturn/reactivation/confirmation) + 通知 + narrative
│   └── w4Impact.ts          # W4 标的关联与影响：标的关联→行情验证(computeImpact)→影响摘要
└── server/
    ├── seed.ts              # 演示语料（7 事件覆盖：多源合并/否认复活/更正/过期/重激活/传闻）
    └── store.ts             # EventStore 单例（globalThis），ingest 管线编排；SEED_VERSION 变更触发重建
```

修改要点：
- 改种子数据或匹配/抽取规则后，必须递增 `store.ts` 的 `SEED_VERSION` 才会重建数据。
- 新证据接入走 `POST /api/ingest`（`mode=rules|llm`），LLM 失败显式降级并在 `warnings` 标注，禁止静默伪造。
- 非法状态转换在 `stateMachine.assertTransition` 阻止；更正/否认/复活必须带 `diffNote`。
- 未知真实标的自动建档：ingest 管线第 1.5 步从 `raw.rawFields.stockCodes/secName/companyName`（实时适配器注入）为库外公司补代码，`ensureTarget` 建档（无代码用 `NAME-<规范名>` 兜底主键，泛指短语黑名单拦截「本公司股份/A股」等非实体）；`opts.requireSubject=true` 时无法识别主体的散文资讯直接抛错跳过，防止「未知主体」垃圾事件。

## 去重与标题规范（dedup/eventTitle）

- **dedup_key 四段式** `subject|action|object|timeWindow`：subject/object 段仅真实证券代码参与（`usableCode` 拦截 `NAME-`/`ENT-` 兜底建档码，回退 `normalizeObjectName`），否则同一对象「建档前用名、建档后用兜底码」会产生两种 key 导致同事件分裂。
- **objectBridge 对象互补合并**（`dedup.ts findMatchingEvent`）：同主体+同动作组+时间窗兼容且对象恰好一方缺失（XOR）时——唯一候选直接 exact 合并；多候选要求 known 对象名在新证据文本中出现以消歧；known 属泛指词表（`GENERIC_OBJECT_PHRASES`）禁止合并。例：无对象公告「关于签署战略合作协议的公告」可并入「宁德时代·与赛力斯签署合作」。
- **事件标题统一 `eventTitle(subject, action, object)`**（vocabulary.ts）：`主体·[与对象]动作`，泛指对象不拼「与X」；OTHER 动作退化为「主体·[与对象]相关动态」（避免「与巧克力换电生态其他」噪音）。动作词表含 `COOPERATE`（签署合作/战略合作，priority 55，低于 TERMINATE 使「终止合作协议」仍判终止）。
- **extractObjectFallback「与X」模式**：`与([一-龥A-Za-z0-9（）()]{2,20}?)(?:签署|签订|达成|...)`，捕获结果以「合作/战略/产业」等泛词收尾时丢弃（防「与产业战略合作」截出伪实体「产业战略」）。

## iFinD 数据源接入说明

- 凭证仅从服务端 `process.env` 读取：`IFIND_MCP_URL`、`IFIND_API_TOKEN`、`IFIND_STOCK_MCP_URL`（Bearer 头），禁止前端引用与日志输出；未配置时接口返回 `configured:false` 并显式降级。
- **凭证加载机制（dev/prod 均生效）**：公开仓库仅提交 `.env.example`，真实凭证填写到已被 `.gitignore` 排除的项目根 `.env` 或后端平台环境变量，禁止提交真实凭证。dev 由 `next dev` 自动加载；prod 自定义服务 `src/server.ts` 顶部 `loadDotEnv()`（仅补缺不覆盖平台注入）保证 `node dist/server.js` 可读。注意 `next build` 不会把 `.env` 内联进服务端代码，运行时加载是唯一通道。填写与部署说明见 `DEPLOYMENT.md`。
- iFinD 共 9 个 MCP 端点（原始 `assets/{.txt` 含凭证，仅留本地，不提交）：主库 hexin-ifind-ds-mcp（公告/新闻/热门）、ds-stock-mcp（股票行情）、fund/edb/news/bond/global-stock/index/futures（未接入，按需扩展）。type 标注 "sse" 但实测兼容 Streamable HTTP（POST JSON-RPC + SSE 响应体解析）。
- 额度保护：进程内缓存（`adapter.ts`，公告 24h / 新闻 12h，过期缓存仍可在宽限期内兜底）、`mcpClient.ts` 全局相邻调用 ≥1.1s、429/5xx/超时指数退避（1s/2s，共 3 次）、`GET /api/ifind/quota` 查看本进程底层 HTTP 调用计数。
- 降级链：iFinD 实时 → 新鲜缓存 → 过期缓存 → 本地演示语料（`origin:'fallback'` + 名称标注）→ 明确"数据服务暂不可用"，禁止伪造实时数据。**仅在调用失败时降级；远程调用成功但无结果（空）时返回 `origin:'remote'` + 空 items + `emptyHint`，绝不静默回退种子**。
- 接口：`POST /api/ifind/fetch`（query/时间窗/size/ingest/mode）拉取并可一键接入主链路；演示台「情报接入台 → iFinD 实时数据」可操作。时间窗兼容多别名：`timeStart/timeEnd`、`time_start/time_end`、`startDate/endDate`、`start/end`、`timeRange:{start,end}`；日期兼容 YYYY-MM-DD / YYYY/MM/DD / YYYYMMDD；**全部未传才默认最近半年**，回显 `timeRange.usedDefaultWindow`。
- 响应解析（`mcpClient.extractEnvelope` + `adapter.extractRows`，双层健壮）：信封可在 `result.content[*].text`（遍历所有 block，非只 [0]）、`result.structuredContent`、`result` 顶层；data 兼容对象数组 / **双重编码 JSON 字符串** / 嵌套 `data.list|records|rows|result|items` / **`# 查询结果` Markdown 表格**。tools/call 的 arguments 必须原样 `query/time_start/time_end/size`（与 MCP 契约同名，禁止改名）。空结果不写缓存（防 24h 毒缓存）。
- iFinD 返回为强相关片段文本（非全文），以 标题+日期+externalId(`IFIND-NOTICE/NEWS-<hash>`) 构成可追溯标识，原始 JSON 存 `rawSnapshot`→证据 `rawFields.rawSnapshot`。
- 严格实时方法（供实时消息用，不回退种子）：`fetchLiveNews(query,start,end,size)`（search_news，query 必填、size 钳制 ≤20）、`fetchTrending(timeScope, {industry,size,keyword,sensitive})`（search_trending_news）。未配置/失败抛错由汇聚层显式降级，远程空结果返回 `origin:'remote'+[]`。
- **search_trending_news 严格枚举契约**（非法值 HTTP 400）：`time_scope ∈ ['6小时','24小时','近一周']`（默认 24小时）；`sensitive ∈ ['正面','负面','中性','全部']`（默认全部）；`industry_name` 为 30 个申万一级行业（`SW_INDUSTRY_NAMES` 白名单校验，非法丢弃）；`size` 必填 ≤20；`keyword` 可选。`daysToTrendingScope(days)` 映射 1→24小时、7/30→近一周（30 天视图在 sources[].warning 备注覆盖范围）。

## 巨潮公开源与实时消息（/api/live）

- `src/lib/adapters/cninfo/adapter.ts`：**无凭证真实公开源** `getCninfoAdapter()`，POST `https://www.cninfo.com.cn/new/hisAnnouncement/query`（form 编码，需 UA/Referer/Origin/X-Requested-With 头），参数 pageNum/pageSize/seDate(`YYYY-MM-DD~YYYY-MM-DD`)/column(空=全市场,sse,szse,bj)/tabName=fulltext/searchkey（支持公司名或股票代码）；映射 announcementId→`CNINFO-<id>`、announcementTime(ms)→disclosedAt、原文链接 `https://static.cninfo.com.cn + adjunctUrl`；5min 内存缓存、12s 超时、网络/5xx 重试 2 次（4xx 不重试）。`isHLtitle=true` 时标题/secName 带 `<em>` 高亮标签，mapRow 必须清洗；rawFields 注入 `{stockCodes:[secCode], secName}` 供主链路建档。globalThis 单例带 `ADAPTER_VERSION` 版本戳，映射结构变更时递增（防 dev 热更后旧缓存缺字段）。
- `src/lib/adapters/media/adapter.ts`：**财经媒体源** `fetchMediaNews()`——36氪=官方 gateway 热榜 API（POST `gateway.36kr.com/api/mis/nav/home/nav/rank/hot`，`{partner_id:'web',timestamp:ms,param:{siteId:1,platformId:2}}`，链接拼 `36kr.com/p/<itemId>`）；虎嗅=官方 RSS `rss.huxiu.com`；钛媒体=官方 RSS `tmtpost.com/rss.xml`（RSS 用正则解析 `<item>`，Node 无 DOM）。10s 超时 + 重试 1 次 + 10min 缓存；`Promise.allSettled` 并行，**单源失败进 failures 不拖垮其他源**；注意 `36kr.com/feed` 是反爬挑战页不可用。
- 汇聚入口 `POST /api/live`：合并 巨潮公告 + iFinD 新闻 + iFinD 热门（无关键词才拉热门）+ 三家媒体资讯，按披露时间倒序 + externalId 去重；body `{q?,days:1|7|30=7,start?,end?,sources?,industry?,pageSize?}`，sources 支持 `media` 或 `media-kr36/huxiu/tmtpost`；媒体流本地按时间窗+关键词过滤。每源独立标注 `sources[].origin`（remote/cache/unavailable）；**任一真实源成功顶层即 remote/cache；只有全部源失败才 origin:'fallback' + “数据服务暂不可用”，实时路径绝不返回种子**；远程空结果给 `emptyHint`。
- `POST /api/live/ingest`：凭 `/api/live` 返回的 `externalId` 从 `liveRegistry`（30min TTL）取真实条目接入主链路，拒绝外部伪造内容。
- 前端 `/live`「实时消息」页：1/7/30 天切换、关键词搜索、来源徽标（巨潮/iFinD 实时/iFinD 热门/缓存）、骨架屏、全部失败与空结果两套指引。**按公司归组展示**（服务端逐条主体识别：rawFields.secName/companyName → 已建档标的+实体库名单长名优先匹配，输出 `subject/subjectCode/eventId` 与 `subjectCount`；**未知主体条目前端直接忽略**并计数提示）；组头公司名+代码可跳标的页；**点击消息卡直达事件监控**（`item.eventId` 已接入直接跳 `/events/[id]`，未接入先调 `/api/live/ingest` 再跳，详情页下滑即见 W4 行情影响验证）。store 提供 `subjectCandidates()` 与 `findEventIdByExternalId()` 支撑（结构变更需递增 SEED_VERSION）。

## Agent 工作流与行情适配器

- 统一入口 `POST /api/workflows/run`（body: `workflow=w1|w2|w3|w4`；w1 需 `query`，w2/w3/w4 需 `eventId`），触发方式为手动输入（本接口）或定时任务（复用同一函数入口）。
- 每个工作流返回 `nodes: WorkflowNodeTrace[]`（node/engine/durationMs/items/detail）+ `warnings`；降级必须显式标注，禁止伪造。
- **W1 事件采集与去重**（`w1Ingestion.ts`）：节点 1 数据采集为多源并行（iFinD 公告+新闻 / 巨潮公开公告 / 财经媒体按 query 过滤，单源失败不拖垮）；节点 2 规则抽取（实体库=种子标的+store 已建档标的，`rawFields.secName/stockCodes` 兜底主体）；节点 3 三级去重——dedup_key 聚类 → **标题归一化规则归并**（去「海外监管公告/H股公告」前缀+日期+标点后相同或互相包含，主体一致或一方缺失）→ **LLM 实体链接**（候选对=要素重叠或标题 bigram Jaccard≥0.55，按 0.6×标题相似+0.4×要素重叠打分取 top5，并查集合并 same&&conf≥0.6 的簇）。提示词明确「同一事项的进展/演化节点（回购方案→进展→完成）属同一事件」。输出 `clusters`（W1E-xxx、标题格式「主体·动作」、mergedByLlm 标记）+ `linkDecisions`（判定理由可追溯）。
- **`callLlmJson`（workflows/types.ts）**：统一 LLM JSON 调用，**必须经 `sanitizeForwardHeaders` 过滤 hop-by-hop 头**（content-length/host/connection 等会使 LLM 网关按错误长度等 body 挂起）；默认 45s 超时保护（Promise.race），W1 实体链接用 25s；失败抛错由调用方显式降级并在 warnings 标注，禁止静默伪造。
- 行情适配器选择链（`getMarketAdapter()`，globalThis 单例带 `MARKET_ADAPTER_VERSION` 版本戳）：FuyaoHttpAdapter（`FUYAO_API_URL`）→ **IfindStockAdapter（`IFIND_STOCK_MCP_URL`，真实 A 股行情）** → MockMarketAdapter（演示降级）。`MarketOrigin = 'fuyao' | 'ifind' | 'fallback'` 三态，前端按 origin 标注（ifind="iFinD 实时行情"徽标）。
- 扶摇真实平台为 `https://fuyao.aicubes.cn`，`FUYAO_API_TOKEN` 通过 `X-api-key` 发送，禁止 Bearer 或旧 `/kline` 假定。路径 `/api/a-share/prices/{snapshot,historical}`；严格校验业务 `code=0` 和 `data.item`；代码带 SH/SZ/BJ，日期为上海时区毫秒，成交量股→手。失败/空结果不伪造成演示数据；一分钟有界缓存和并发去重。Pages 详情行情区通过同一后端 `/api/market/{code}` 展示来源、报价、日线及错误。
- **iFinD 股票行情（`src/lib/adapters/ifind/stockAdapter.ts`）**：ds-stock-mcp 10 个工具全为自然语言 query 驱动（tools/list 实测：get_stock_performance/get_stock_summary/get_stock_info/search_stocks/stock_highfreq_quotes 等）。`getKline` 调 get_stock_performance，返回 `data.answer` Markdown 表格（|证券代码|日期|最高价|收盘价|成交量|最低价|开盘价|涨跌幅|，`extractRows` 键列表已加 `answer`），日期 YYYYMMDD、成交量带"万/亿"单位（parseCnNumber）、非交易日行仅收盘价须过滤；30min 缓存。`getProfile` 调 get_stock_summary 取概况原文（6h 缓存），供标的页"行业与板块"卡。
- 行情接口 `GET /api/market/[code]?start&end&eventDate&sentiment`；搜索接口 `GET /api/search?q=`（含 emptyHints/suggestions 空状态指引）。
- **搜索实时接入（核心动线）**：`GET /api/search?q=&live=1` 并行拉取巨潮（searchkey=q，支持公司名/代码）+ iFinD fetchLiveNews + 财经媒体（本地按 q 过滤），逐条 `store.ingest({extractorMode:'rules', requireSubject:true})` 幂等接入主链路，返回合并后的本地+实时事件与 `live:{fetched,ingested,skipped,errors,sources[]}` 报告。q 判定为实体名（`isEntityLike`：2-12 字、非纯数字、非通用词黑名单）时给无 secName 的条目注入 `rawFields.companyName=q` 辅助主体归属。前端 `/search` 两段式：先本地快速返回，再自动触发 live=1（状态条展示来源徽标与接入统计），空结果等 live 完成后再出指引。

## 开放 API（GitHub Pages 前端对接）

- **CORS**：`src/middleware.ts` 统一匹配 `/api/:path*`，反射 Origin 注入 CORS 头并直接 204 接管 OPTIONS 预检；外部静态站点（GitHub Pages 等）可直接 `fetch` 全部 `/api/*` 端点，无需代理。
- **自描述索引**：`GET /api` 返回 baseUrl、全端点契约（方法/路径/参数/响应）、字段约定（状态/证据类型/来源类型词表）。
- **演示数据新鲜度**：`seed.ts` 全部时间戳由 `ago(n)`/`agoText(n)` 相对当前时间动态生成（模块加载时计算），事件链间隔固定；改语料后递增 `store.ts` 的 `SEED_VERSION` 触发重建。

## 页面结构（白红同花顺风格，详见 DESIGN.md）

- `/` 搜索中心首页（居中搜索框约 60% 宽 + 热门标签点击即搜）；`/search?q=` 结果页（骨架屏/空状态指引/建议搜索词）。
- `/events` 事件监控列表；`/events/[id]` 详情页：吸顶状态摘要卡（W2 credibilityText）、证据按高低权重分组默认折叠、W4 影响分析（迷你行情图，红涨绿跌）、工作流节点轨迹面板。
- `/targets/[code]` 标的整合视图（用户动线终点：宽泛搜索→找到公司→整合全部信息）：左上角"← 返回首页"；标的信息卡（代码/市场/行业 + 行情快照最新价涨跌幅 + 近 80 日走势迷你图 + 来源徽标）；iFinD 概况卡（行业/板块/主营原文）；事件涉及标的 chips（可跳转到对应标的页）；关联事件时间线（竖线节点，每事件带状态/主体→动作→对象/涉及标的/影响验证行——事件日涨跌幅、次日、量比、区间涨跌、"量价异动"标记）。数据来自 `GET /api/targets/[code]`（target+events+market{origin,quote,kline}+impacts{eventId:TargetImpact}+profile）：一次 K 线拉取全事件复用 computeImpact；非 A 股建档标的（NAME-/ENT-）如实标注"暂无行情验证数据"不伪造；W4 同样剔除「未指明/未知主体」占位标的并跳过非 A 股拉取。
- 顶部通栏导航 `src/components/app/top-nav.tsx`（替代旧侧边栏），未读通知角标 15s 轮询。
