import { c, getLocale } from '../cli-ui.js';
import { loadConfig } from '../config.js';
import { priceCatalogStatus, resetPriceCatalog, updatePriceCatalog } from './catalog.js';

function printStatus(status, zh) {
  const source = status.source === 'downloaded'
    ? (zh ? '社区下载（本机缓存）' : 'Community download (local cache)')
    : (zh ? '随包内置（离线回退）' : 'Bundled (offline fallback)');
  console.log(`${c.bold(zh ? '价格目录' : 'Pricing catalog')}: ${c.cyan(status.version)} · revision ${status.revision}`);
  console.log(`  ${zh ? '来源' : 'Source'}: ${source}`);
  console.log(`  ${zh ? '条目' : 'Entries'}: ${status.entryCount}`);
  console.log(`  ${zh ? '最近检查' : 'Last checked'}: ${status.lastCheckedAt || '—'}`);
  console.log(`  SHA-256: ${status.integrity.digest.slice(0, 16)}…`);
}

export async function runPricingCommand(args = []) {
  const zh = getLocale() === 'zh';
  const action = args[0] || 'status';
  const json = args.includes('--json');
  if (action === 'status') {
    const status = priceCatalogStatus();
    if (json) console.log(JSON.stringify(status, null, 2));
    else printStatus(status, zh);
    return status;
  }
  if (action === 'update') {
    const config = loadConfig();
    const apiIndex = args.indexOf('--api-url');
    const apiUrl = apiIndex >= 0 ? args[apiIndex + 1] : config?.apiUrl;
    if (apiIndex >= 0 && (!apiUrl || apiUrl.startsWith('--'))) throw new Error('--api-url 需要一个值。');
    const result = await updatePriceCatalog({
      apiUrl: apiUrl || 'https://kimi.builders',
      force: args.includes('--force'),
    });
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(result.changed
        ? (zh ? `价格目录已更新至 ${result.version}（revision ${result.revision}）。` : `Pricing updated to ${result.version} (revision ${result.revision}).`)
        : (zh ? `价格目录已是最新：${result.version}。` : `Pricing is current: ${result.version}.`));
      printStatus(result, zh);
    }
    return result;
  }
  if (action === 'reset') {
    const status = resetPriceCatalog();
    if (json) console.log(JSON.stringify(status, null, 2));
    else {
      console.log(zh ? '已移除下载缓存，恢复使用随包内置价格目录。' : 'Downloaded pricing was removed; the bundled catalog is active.');
      printStatus(status, zh);
    }
    return status;
  }
  throw new Error(zh ? `未知 pricing 命令：${action}` : `Unknown pricing command: ${action}`);
}

