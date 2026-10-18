import { createServer } from 'http';
import { parse } from 'url';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import next from 'next';

// 自定义 server 不会自动加载 .env（next dev/next start 才会）：
// 这里极简解析项目根 .env 补缺（不覆盖平台已注入的环境变量），dev/prod 一致生效。
function loadDotEnv(): void {
  try {
    const file = resolve(process.cwd(), '.env');
    if (!existsSync(file)) return;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const [, key, rawVal] = m;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawVal.replace(/^["']|["']$/g, '');
    }
  } catch {
    // .env 缺失或解析失败不阻塞启动
  }
}
loadDotEnv();

const dev = process.env.COZE_PROJECT_ENV !== 'PROD';
const hostname = process.env.HOSTNAME || 'localhost';
const port = parseInt(process.env.PORT || '5000', 10);

// Create Next.js app
const app = next({ dev, hostname, port, webpack: true });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling', req.url, err);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.once('error', err => {
    console.error(err);
    process.exit(1);
  });
  server.listen(port, () => {
    console.log(
      `> Server listening at http://${hostname}:${port} as ${
        dev ? 'development' : process.env.COZE_PROJECT_ENV
      }`,
    );
  });
});
