# 投资事件情报平台（Investment Event Intelligence）

面向二级市场的投资事件情报与证据时间线系统：把多源公告/新闻/媒体资讯，经**要素抽取 → 去重合并 → 状态机演化 → 标的关联与行情验证**的主链路，整理成「一个事件一张卡片、每条结论可追溯证据」的可信情报视图。

- 技术栈：Next.js 16（App Router）+ React 19 + TypeScript 5 + shadcn/ui + Tailwind CSS 4
- 视觉规范：白红「同花顺风格」工作台（详见 `DESIGN.md`）
- 工程规范：见 `AGENTS.md`

---

## 目标用户

| 用户 | 诉求 | 平台对应能力 |
| --- | --- | --- |
| 个人投资者 | 3 秒知道「这家公司发生了什么、是真是假」 | 搜索中心 → 事件卡片（状态徽章 + 置信度一句话） |
| 研究员 / 分析师 | 30 秒下钻证据链，区分事实/观点/传闻 | 事件详情：证据按权重分组、来源分级（公告级>研报级>媒体级>社媒级）、原文出处跳转 |
| 事件驱动交易者 | 跟踪事件演化（更正/否认/反转）并验证量价异动 | 状态机时间线 + W4 行情影响验证（事件日涨跌幅、量比、区间涨跌） |

用户动线：**宽泛搜索 → 找到公司/标的 → 整合全部信息**（标的页：行情快照 + 走势 + 公司概况 + 关联事件时间线 + 影响验证）。

## 核心设计

### 主链路

```
证据(Evidence) → 要素抽取(Extract) → 去重合并(Dedup) → 状态机演化(StateMachine) → 通知(Notify)
```

- **纯函数领域层**（`src/lib/domain/`，无 IO 可单测）与服务端存储（`src/lib/server/store.ts`，内存单例）严格分离。
- **dedup_key 四段式** `subject|action|object|timeWindow`：仅真实证券代码参与（`usableCode` 拦截 `NAME-`/`ENT-` 兜底建档码，防止同一对象两种 key 导致同事件分裂）。
- **objectBridge 对象互补合并**：同主体+同动作组+时间窗兼容且对象恰好一方缺失时，唯一候选直接合并；多候选要求已知对象名在新证据文本中出现以消歧；泛指词（合作方/交易对方等）禁止合并。
- **事件标题统一 `eventTitle()`**：`主体·[与对象]动作`（如「宁德时代·与赛力斯签署合作」）；OTHER 动作退化为「主体·相关动态」避免噪音。
- **状态机**（`stateMachine.ts`）：初发布/有更新/已更正/已否认/已过期/反转；非法转换直接拒绝；更正/否认/复活必须带 `diffNote`（禁止无声修改）；复活门槛=官方确认或 ≥3 独立高质量来源。
- **证据权重六要素评分** + 事件可信度分级，高/低权重证据分组展示。

### Agent 工作流（W1-W4，`src/lib/workflows/`）

| 工作流 | 职责 | 关键点 |
| --- | --- | --- |
| W1 事件采集与去重 | 多源并行采集 → 规则抽取 → 三级去重 | dedup_key 聚类 → 标题归一化规则归并 → **LLM 实体链接**（并查集合并） |
| W2 证据分级与时间线 | 来源分级 + 可信度文案 | T1 公告级 > T2 研报级 > T3 媒体级 > T4 社媒级 |
| W3 版本演化 | supplement/correction/overturn/reactivation/confirmation | 演化图 + 通知 + narrative |
| W4 标的关联与影响 | 标的关联 → 行情验证（computeImpact）→ 影响摘要 | 事件窗口量价异动（涨跌幅/量比/区间涨跌） |

每个工作流返回 `nodes: WorkflowNodeTrace[]`（节点/引擎/耗时/明细）+ `warnings`，降级必须显式标注。

## AI 角色

LLM 在系统中是**增强者而非决策者**，规则优先、LLM 补充、失败显式降级（禁止静默伪造）：

1. **事件实体链接（W1 核心）**：判断两条信息是否同一事件。不只靠关键词，而是按事件核心要素（谁、做了什么、对谁、什么时候）语义匹配；提示词明确「同一事项的进展/演化节点（回购方案→进展→完成）属同一事件」「总主体一致时着重考虑，尽量合并」。候选对按 0.6×标题相似+0.4×要素重叠打分取 top5，并查集合并 `same && conf≥0.6` 的簇，判定理由落 `linkDecisions` 可追溯。
2. **要素抽取（可选 `mode=llm`）**：`LlmExtractor` 语义抽取主体/动作/对象/时间；失败自动降级 `RuleExtractor` 并在 `warnings` 标注。
3. **统一调用层 `callLlmJson`**：经 `sanitizeForwardHeaders` 过滤 hop-by-hop 头（content-length 等会导致 LLM 网关挂起），45s 超时保护（W1 实体链接 25s）。

## 数据使用

| 数据源 | 内容 | 接入方式 |
| --- | --- | --- |
| 同花顺 iFinD MCP | 公告 / 新闻 / 热门资讯 / A 股行情 / 公司概况 | Streamable HTTP（JSON-RPC + SSE），凭证仅服务端 `.env`：`IFIND_MCP_URL`/`IFIND_STOCK_MCP_URL`/`IFIND_API_TOKEN` |
| 巨潮资讯网 | 全市场法定公告（无凭证公开源） | `cninfo.com.cn` 查询接口，5min 缓存 + 重试 |
| 财经媒体 | 36氪（官方热榜 API）/ 虎嗅 RSS / 钛媒体 RSS | 10min 缓存，单源失败不拖垮其他源 |
| 演示语料 | 7 个种子事件（多源合并/否认复活/更正/过期/重激活/传闻） | `seed.ts`，时间戳相对当前动态生成 |

**额度保护与降级链**：进程内缓存（公告 24h/新闻 12h/行情 30min）→ 全局相邻调用 ≥1.1s → 429/5xx 指数退避；降级链 = 实时 → 新鲜缓存 → 过期缓存 → 演示语料（显式标注 `origin:'fallback'`），**远程成功但无结果时绝不静默回退种子**。实时路径（/api/live）绝不返回种子数据。

### 快速开始

```bash
pnpm install
cp .env.example .env   # 配置 iFinD 凭证（可选，缺失时显式降级）
coze dev               # 开发（热更新，端口 5000）
coze build && coze start   # 生产
```

### 开放 API

- `GET /api` 自描述索引（全端点契约 + 词表）；CORS 已全局放开（`src/middleware.ts`），外部静态站点可直接 fetch。
- 核心端点：`/api/search`（含 `live=1` 实时接入）、`/api/events`、`/api/events/[id]`、`/api/targets/[code]`、`/api/live`、`/api/ingest`、`/api/workflows/run`、`/api/market/[code]`。

### 纯前端静态版（`output/`）

`output/index.html` + `output/frontend/style.css` + `output/frontend/app.js`：零依赖单页应用，可直接部署到 GitHub Pages 等任意静态托管；`app.js` 顶部 `API_BASE` 为 API 调用占位（指向本平台 `/api`），请求失败时自动降级内置模拟数据渲染。

## 已知边界

- **规则抽取对散文式资讯的主体识别有限**：依赖实体库命中与实时源 `rawFields.secName/stockCodes` 注入；无法识别主体的资讯被 `requireSubject` 防线丢弃（前端实时消息页对未知主体条目直接忽略）。
- **无对象公告无法确定归属时独立成卡**：如「关于签署战略合作协议的公告」正文不含合作方名称，不会强行并入任何事件（不伪造归属）。
- **`NAME-`/`ENT-` 兜底建档标的无行情验证**：非 A 股代码标的在标的页如实标注「暂无行情验证数据」。
- **iFinD 返回为强相关片段文本**（非公告/新闻全文），以 标题+日期+externalId 构成可追溯标识，原始 JSON 存 `rawSnapshot`。
- **事件存储为内存单例**（`globalThis`），重启即重置为种子语料；`SEED_VERSION` 变更触发重建。
- **扶摇行情（Fuyao）未启用**：token 已配置但服务 URL 缺失，行情由 iFinD ds-stock-mcp 承接。

## 未做事项

- iFinD 其余 7 个 MCP 端点（fund/edb/news/bond/global-stock/index/futures）未接入，按需扩展。
- 定时任务自动触发工作流（函数入口已预留复用，未接调度器）。
- 研报、互动易/互动记录等更多来源类型。
- 用户账号体系、多人协作与收藏数据持久化（当前收藏/通知为会话内状态）。
- WebSocket 实时推送（当前通知角标为 15s 轮询）。
- 持久化数据库（内存 store → 数据库的适配层未实现）。
