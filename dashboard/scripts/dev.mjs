import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocalDashboardServer } from '../../src/local/dashboard-server.js';

const dashboardRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const noOpen = process.argv.includes('--no-open');
let browserOrigin = '';
let localServer = null;
let viteServer = null;
let closing = false;

function openBrowser(url) {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

async function shutdown(exitCode = 0) {
  if (closing) return;
  closing = true;
  await Promise.allSettled([
    viteServer?.close(),
    localServer?.close(),
  ]);
  process.exitCode = exitCode;
}

try {
  let createViteServer;
  try {
    ({ createServer: createViteServer } = await import('vite'));
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error('尚未安装看板开发依赖。请先运行 `npm run setup`，完成后再运行 `npm run dev`。');
    }
    throw error;
  }
  console.log('正在读取本机 Agent 用量并启动开发看板…');
  localServer = await startLocalDashboardServer({
    launchBrowser: false,
    serveStatic: false,
    authRedirectOrigin: () => browserOrigin,
  });

  viteServer = await createViteServer({
    configFile: resolve(dashboardRoot, 'vite.config.mjs'),
    root: dashboardRoot,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': {
          target: localServer.origin,
          changeOrigin: true,
          configure(proxy) {
            proxy.on('proxyReq', (request) => {
              request.setHeader('origin', localServer.origin);
            });
          },
        },
      },
    },
  });
  await viteServer.listen();

  const address = viteServer.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite 未返回可用的本地端口。');
  browserOrigin = `http://127.0.0.1:${address.port}`;

  console.log(`开发看板: ${browserOrigin}`);
  console.log('前端热更新与真实本地 API 已同时启用。');
  console.log(`如果浏览器没有自动打开，请访问: ${localServer.url}`);
  console.log('按 Ctrl+C 即可同时停止前端和本地 API。');
  if (!noOpen) openBrowser(localServer.url);

  process.once('SIGINT', () => { shutdown(0); });
  process.once('SIGTERM', () => { shutdown(0); });
} catch (error) {
  console.error(`开发看板启动失败: ${error?.message || error}`);
  await shutdown(1);
}
