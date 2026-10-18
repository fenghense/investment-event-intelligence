# API 配置与 Pages 接入

源码上传到 GitHub 不等于后端已部署。仓库中的 `Main.zip` 是手动上传的归档文件，不参与项目启动；部署平台应读取展开后的 `package.json`、`src/` 等文件。

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
| `FUYAO_API_URL` | 可选，扶摇 HTTP 行情服务的基础地址，不包含末尾 `/kline` |
| `FUYAO_API_TOKEN` | 可选，与上一个地址配套的扶摇 Token 本体 |

不使用扶摇时，最后两项均留空。只有扶摇 Token 而没有服务地址时，不能启用扶摇行情；可以先使用 iFinD 行情。

## 二、把后端运行起来

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

取得后端的 HTTPS 地址后，修改 `frontend/app.js` 顶部：

```js
var API_BASE = 'https://你的后端域名';
```

填写项目后端域名，不要填 iFinD 域名、API 密钥或末尾 `/api`。代码会追加 `/api/...`。后端 `src/middleware.ts` 已包含跨域响应与 OPTIONS 预检支持，部署平台还需允许公开访问该 API，不能被平台登录页拦截。

当前静态前端还有以下待接入调整，不能只填写地址就视为实时数据接入完成：

1. `fetchEvents` 有关键词时应请求 `/api/search?live=1&q=...`，才能触发实时数据采集；无关键词时应请求 `/api/events`。
2. 删除 `if (!list.length) throw new Error('empty');`，将合法的空列表呈现为空结果，不能误当故障回退演示数据。
3. 根据返回的 `live.sources` 区分上游实时成功、无结果或失败；接口返回 HTTP 200 不代表 iFinD 已成功取数。
4. 若要展示完整证据时间线，还需调用 `/api/events/{id}`，将其中的 `evidence` 数据映射到详情弹窗；搜索列表本身不包含完整证据。

本次源码上传保留了既有 Pages 页面行为，没有代填未知的后端地址。

## 四、验证配置

后端启动后依次检查：

1. `GET /api`：应返回 JSON 接口说明，不是 HTML 登录页。
2. `GET /api/ifind/quota`：`configured: true` 仅表示配置值非空，不验证 Token 是否有效。
3. `GET /api/search?q=宁德时代&live=1`：会实际调用数据源并消耗其额度；检查 `live.sources` 中 `ifind` 的状态及错误信息。`ok` 是有数据，`empty` 是成功但无结果，`failed` 是调用失败。
4. 从 Pages 发起请求，确认浏览器 Network 中请求发往后端域名，并且没有 CORS 或 HTTPS 错误。

如果 `Main.zip` 中包含旧密钥，即使本次展开的源码已排除密钥，该归档及旧提交仍可能公开包含它们；本次上传未修改你原先上传的归档。
