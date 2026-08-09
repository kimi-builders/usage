import { fetchSummary } from './api.js';
import { loadConfig } from './config.js';

function compact(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(value);
}

export async function runSummary(days = 7) {
  const config = loadConfig();
  if (!config?.apiKey) throw new Error('尚未连接设备。');
  const response = await fetchSummary(config.apiUrl, config.apiKey, days);
  const data = response.data;
  console.log(`最近 ${data.days} 天`);
  console.log(`  Token   ${compact(data.totals.totalTokens)}`);
  console.log(`  会话    ${data.totals.sessions}`);
  console.log(`  活跃    ${Math.round(data.totals.activeSeconds / 60)} 分钟`);
  console.log(`  设备    ${data.activeDevices}`);
}

