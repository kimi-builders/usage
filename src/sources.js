import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, saveConfig } from './config.js';
import { sourceRegistry } from './parsers/index.js';

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} 需要一个值。`);
  return value;
}

export function runSources(args = []) {
  const config = loadConfig();
  const action = args[0] || 'list';
  const sourceId = args[1];
  const optional = sourceRegistry.filter((source) => source.tier === 'explicit-opt-in');
  const enabled = new Set(config?.enabledSources || []);

  if (action === 'list') {
    console.log('数据源：');
    for (const source of sourceRegistry) {
      const status = source.tier === 'explicit-opt-in'
        ? enabled.has(source.id) ? '已启用（显式）' : '未启用（显式）'
        : '自动启用';
      console.log(`  ${source.id.padEnd(16)} ${status}`);
    }
    return;
  }
  if (!config?.apiKey) throw new Error('尚未连接设备，请先运行 init。');
  const source = optional.find((item) => item.id === sourceId);
  if (!source) throw new Error(`可显式配置的数据源不存在: ${sourceId || '(missing)'}`);

  const sourceOptions = { ...(config.sourceOptions || {}) };
  if (action === 'enable') {
    if (sourceId === 'cursor') {
      const csv = option(args, 'csv');
      if (!csv) throw new Error('启用 Cursor 需要 --csv PATH（Cursor Dashboard 主动导出的 usage CSV）。');
      const csvPath = resolve(csv);
      if (!existsSync(csvPath) || !statSync(csvPath).isFile()) {
        throw new Error(`Cursor CSV 不存在或不是文件: ${csvPath}`);
      }
      sourceOptions.cursor = { csvPath };
    }
    enabled.add(sourceId);
    saveConfig({ ...config, enabledSources: [...enabled].sort(), sourceOptions });
    console.log(`已启用 ${sourceId}。`);
    return;
  }
  if (action === 'disable') {
    enabled.delete(sourceId);
    delete sourceOptions[sourceId];
    saveConfig({ ...config, enabledSources: [...enabled].sort(), sourceOptions });
    console.log(`已停用 ${sourceId}；远端历史数据未删除。`);
    return;
  }
  throw new Error(`未知 sources 操作: ${action}`);
}
