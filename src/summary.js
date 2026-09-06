import { fetchSummary } from './api.js';
import { loadConfig } from './config.js';
import { getLocale } from './cli-ui.js';
import { runStats } from './stats.js';

function compact(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}

export async function runSummary(days = 7, { remote = false, json = false } = {}) {
  if (remote) {
    const isZh = getLocale() === 'zh';
    const config = loadConfig();
    if (!config?.apiKey) throw new Error(isZh ? '尚未连接设备。' : 'This device is not connected.');
    const response = await fetchSummary(config.apiUrl, config.apiKey, days);
    const data = response.data;
    if (json) {
      console.log(JSON.stringify(data, null, 2));
      return data;
    }
    console.log(isZh ? `最近 ${data.days} 天 (云端社区汇总)` : `Last ${data.days} days (community summary)`);
    console.log(`  Token   ${compact(data.totals.totalTokens)}`);
    console.log(`  ${isZh ? '会话' : 'Sessions'}    ${data.totals.sessions}`);
    console.log(`  ${isZh ? '活跃' : 'Active'}    ${Math.round(data.totals.activeSeconds / 60)} ${isZh ? '分钟' : 'minutes'}`);
    console.log(`  ${isZh ? '设备' : 'Devices'}    ${data.activeDevices}`);
    return data;
  }
  return runStats({ days, period: `${days}d`, json });
}

