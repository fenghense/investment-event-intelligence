# API 配置与 Pages 接入

源码上传到 GitHub 不等于后端已部署。仓库中的 `Main.zip` 是手动上传的归档文件，不参与项目启动；部署平台应读取展开后的 `package.json`、`src/` 等文件。

## 当前服务

- Pages：<https://fenghense.github.io/investment-event-intelligence/>
- Render 后端：<https://investment-event-intelligence-api.onrender.com>
- 健康检查：<https://investment-event-intelligence-api.onrender.com/api/health>
- 环境变量管理：[Render Environment](https://dashboard.render.com/web/srv-dbab368m7kps7385r50g/env)。更新 `IFIND_API_TOKEN` 后保存并重新部署。

当前已创建新加坡区域 Free Web Service，连接本仓库 `main`，Auto-Deploy 为 On Commit。后续更新直接提交到 `main`；不要再创建重复服务。下面的创建步骤供迁移或重新部署时使用。

## 一、密钥在哪里填

### 本地运行

1. 将根目录 `.env.example` 复制为同目录的 `.env`。
2. 在 `.env` 中填写密钥；`.env` 已被 Git 忽略。
3. 修改配置后重启服务。

### 云端运行

在**运行 Next.js 后端的平台**中，打开「环境变量 / Environment Variables」，逐项添加下面的变量，保存后重新部署或重启后端。

不要将密钥填入 `frontend/app.js`、`.env.example` 或 `NEXT_PUBLIC_*` 变量。GitHub 仓库的 Secrets 不会自动注入外部后端，更不会让 Pages 运行 Node.js。

| 变量名 | 填什么 |
| --- | --- |
| `IFIND_MCP_URL` | 使用 `.env.example` 已提供的公告 / 新闻 MCP 地址；服务商更换端点时再更新 |
| `IFIND_API_TOKEN` | iFinD 提供的 MCP Token 本体；不含 `Bearer ` 前缀，代码会自动添加 |
| `IFIND_STOCK_MCP_URL` | 使用 `.env.example` 已提供的 A 股行情 MCP 地址；复用同一个 iFinD Token |
| `FUYAO_API_URL` | `https://fuyao.aicubes.cn`，不含 `/admin` 或 `/api` |
| `FUYAO_API_TOKEN` | 扶摇「API Key 管理」签发的 API Key 原文，服务端放入 `X-api-key` 请求头 |

扶摇负责行情快照和历史日 K 线；iFinD 继续负责新闻搜索和公司概况。扶摇未配置完整时，行情使用已配置的 iFinD。调用失败会显式报错或标注部分数据缺失，不冒充成功。

扶摇官方契约：[快速开始](https://fuyao.aicubes.cn/docs/quickstart/)、[股票行情](https://fuyao.aicubes.cn/docs/api-reference/prices/)。真实路径是 `/api/a-share/prices/snapshot` 和 `/api/a-share/prices/historical`，不是 `/kline`。业务错误通过 JSON `code` 表达，即使 HTTP 200 也必须检查 `code === 0`。历史请求使用带交易所后缀的代码和上海时区毫秒时间窗；成交量从股换算为领域层的手。

## 二、把后端运行起来

### Render 免费版（本项目已准备自动部署配置）

根目录 `render.yaml` 定义了一个新加坡区域的免费 Node.js Web Service，分支为 `main`，每次推送都会自动部署；不会创建数据库或付费服务。

1. 登录 Render，连接 GitHub，授权本仓库。
2. 选择 **New → Blueprint**，选择本仓库和 `main` 分支，让 Render 读取 `render.yaml`。
3. 在提示中填写 `IFIND_API_TOKEN` 和 `FUYAO_API_TOKEN`；接口地址已经配置好。创建前确认计划为 **Free**。
4. 等待服务变为 **Live**，复制实际分配的 `https://…onrender.com` 地址。不要按服务名猜域名，Render 可能添加后缀。
5. 按下一节将这个地址填入 Pages 配置并提交。

如果从 **New → Web Service** 手动创建，选择本仓库 `main`、Node、Singapore、Free，并使用：

- Build Command：`corepack pnpm install --frozen-lockfile --registry=https://registry.npmjs.org && corepack pnpm exec next build --webpack`
- Start Command：`corepack pnpm exec next start --hostname 0.0.0.0 --port $PORT`
- 环境变量：`NODE_VERSION=24`、`NEXT_TELEMETRY_DISABLED=1`，以及模板中的三个 `IFIND_*` 和两个 `FUYAO_*` 变量。
- Health Check Path：`/api/health`。
- Auto-Deploy：每次提交自动部署（On Commit）。

首次创建时可能需要完成账号验证；如页面要求付费，先停下确认，不要自动升级。免费实例空闲 15 分钟会休眠，再次访问唤醒通常约一分钟；内存事件库也会随进程重启而重建。面试展示前先打开后端预热一次。

官方参考：[Render Next.js 部署](https://render.com/docs/deploy-nextjs-app)、[免费版限制](https://render.com/docs/free)。

### 其他 Node.js 环境

若原扣子编程项目已经发布，可以使用它的 HTTPS 发布地址，无需再部署一份后端。

若选择其他平台，需要创建支持 Node.js 的 Web 服务，而不是静态站点。工作目录选择含 `package.json` 的目录。普通 Node.js 部署可使用以下命令（需要 Node.js 20.9+ 和 pnpm 9，具体以所选平台与依赖要求为准）：

```sh
pnpm install --frozen-lockfile
pnpm exec next build --webpack
pnpm exec next start --hostname 0.0.0.0 --port 5000
```

最后一行是长期运行的启动命令；云平台若分配其他端口，应将 `5000` 换成平台要求的端口。使用这些标准 Next.js 命令时，会自动读取项目根目录 `.env`，平台注入的环境变量优先。

仓库原有 `pnpm build` / `pnpm start` 是面向扣子环境的自定义脚本；在其他平台直接使用时，还需适配端口并将 `COZE_PROJECT_ENV` 设置为 `PROD`。上面的标准 Next.js 启动方式不依赖该变量。

注意：事件与收藏使用进程内存，重启会重建种子数据；多实例或无状态函数部署不会自动共享这些数据。LLM 增强另依赖 `coze-coding-dev-sdk` 的运行环境配置，iFinD Token 不代替 LLM 凭证；未配置时使用已有的显式降级逻辑。

官方参考：[Next.js 部署](https://nextjs.org/docs/app/getting-started/deploying)。

## 三、连接 GitHub Pages

Pages 只托管静态前端，不能运行本项目的 `/api/*` 后端路由。当前 Pages 使用仓库根 `index.html` 和 `frontend/`，不是 `output/` 目录。

取得后端的 HTTPS 地址后，修改 `frontend/config.js`（导出副本 `output/frontend/config.js` 保持同步）：

```js
window.APP_CONFIG = {
  apiBase: 'https://你的后端域名'
};
```

填写项目后端域名，不要填 iFinD 域名、API 密钥或末尾 `/api`。代码会追加 `/api/...`。后端 `src/middleware.ts` 已包含跨域响应与 OPTIONS 预检支持，部署平台还需允许公开访问该 API，不能被平台登录页拦截。

静态前端已包含以下接入行为：

1. 有关键词时请求 `/api/search?live=1&q=...` 触发实时采集；无关键词时请求 `/api/events`。
2. 合法空列表呈现为空结果；已配置后端时的请求失败会明确报错，不再偷偷替换为演示数据。只有配置地址为空时才进入明确标注的离线演示模式。
3. 根据 `live.sources` 展示各数据源有数据、无新数据或不可用；首页明确标记事件库可能包含初始化演示记录，HTTP 200 不等于上游实时取数成功。
4. 点击事件后调用 `/api/events/{id}` 加载证据；关闭弹窗后晚到的响应不会重新打开弹窗，旧搜索结果也不会覆盖新搜索。
5. 有有效 A 股主体代码的事件详情会请求 `/api/market/{code}`，显示来源、报价及日收盘价走势；扶摇为前复权日线。行情失败不影响证据展示，演示行情明确标注。

配置提交后，GitHub Pages 会按已有分支发布设置自动更新；Render 也会按 `main` 的提交自动部署。两者互相独立，首次接通必须等后端部署成功并填写其真实地址。API 密钥不进入 Pages 文件。

## 四、验证配置

后端启动后依次检查：

1. `GET /api`：应返回 JSON 接口说明，不是 HTML 登录页。
2. `GET /api/ifind/quota`：`configured: true` 仅表示配置值非空，不验证 Token 是否有效。
3. `GET /api/search?q=宁德时代&live=1`：会实际调用数据源并消耗其额度；检查 `live.sources` 中 `ifind` 的状态及错误信息。`ok` 是有数据，`empty` 是成功但无结果，`failed` 是调用失败。
4. 从 Pages 发起请求，确认浏览器 Network 中请求发往后端域名，并且没有 CORS 或 HTTPS 错误。
5. `GET /api/market/300750`：接通扶摇后应返回 `origin: "fuyao"`，核对 `quote`、`kline` 和 `warnings`；`origin` 本身不代表一定有有效数据。Pages 中打开宁德时代事件可看到同一结果。

本地回归测试：`corepack pnpm run test:pages` 和 `corepack pnpm run test:fuyao`。健康检查 `/api/health` 不调用上游 API、不消耗额度。

如果 `Main.zip` 中包含旧密钥，即使本次展开的源码已排除密钥，该归档及旧提交仍可能公开包含它们；本次上传未修改你原先上传的归档。
