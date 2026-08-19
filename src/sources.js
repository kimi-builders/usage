import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSessionSalt, loadConfig, saveConfig } from './config.js';
import { sourceRegistry } from './parsers/index.js';
import { applySourcePolicies, effectiveSourcePolicies, isSourceMode } from './source-policy.js';
import { c, getLocale, renderTable, t } from './cli-ui.js';

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`--${name} 需要一个值。`);
  return value;
}

export function runSources(args = []) {
  const loadedConfig = loadConfig();
  const config = loadedConfig || {};
  const action = args[0] || 'list';
  const sourceId = args[1];
  const optional = sourceRegistry.filter((source) => source.tier === 'explicit-opt-in');
  const enabled = new Set(config?.enabledSources || []);
  const policies = effectiveSourcePolicies(config);
  const isZh = getLocale() === 'zh';

  if (action === 'list') {
    if (args.includes('--json')) {
      const jsonList = sourceRegistry.map((source) => ({
        id: source.id,
        tier: source.tier,
        mode: policies[source.id],
        enabled: policies[source.id] !== 'off',
      }));
      console.log(JSON.stringify(jsonList, null, 2));
      return jsonList;
    }

    console.log(isZh ? '数据源：' : 'Data Sources:');
    for (const source of sourceRegistry) {
      const mode = isZh
        ? { off: '关闭', local: '仅本机', private: '本机并同步' }[policies[source.id]]
        : { off: 'Off', local: 'Local only', private: 'Local & sync' }[policies[source.id]];
      const tierTag = source.tier === 'beta'
        ? (isZh ? '（Beta）' : ' (Beta)')
        : source.tier === 'explicit-opt-in'
          ? (isZh ? '（显式数据源）' : ' (Explicit)')
          : '';
      const status = `${mode}${tierTag}`;
      const coloredMode = policies[source.id] === 'private'
        ? c.green(status)
        : policies[source.id] === 'local'
          ? c.cyan(status)
          : c.gray(status);
      console.log(`  ${source.id.padEnd(18)} ${coloredMode}`);
    }
    return;
  }
  if (action === 'set') {
    const source = sourceRegistry.find((item) => item.id === sourceId);
    const mode = args[2];
    if (!source) throw new Error(`数据源不存在: ${sourceId || '(missing)'}`);
    if (!isSourceMode(mode)) throw new Error('模式必须是 off、local 或 private。');
    if (sourceId === 'cursor' && mode !== 'off' && !config.sourceOptions?.cursor?.csvPath) {
      throw new Error('Cursor 需要先运行 `sources enable cursor --csv PATH` 配置导出的 usage CSV。');
    }
    const next = applySourcePolicies({
      ...config,
      sessionSalt: config.sessionSalt || createSessionSalt(),
      ...(!loadedConfig ? { onboardingPending: true } : {}),
    }, { [sourceId]: mode });
    saveConfig(next);
    console.log(`${sourceId} 已设为 ${{ off: '关闭', local: '仅本机扫描', private: '本机扫描并同步' }[mode]}；远端历史数据未删除。`);
    return;
  }
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
    saveConfig(applySourcePolicies({
      ...config,
      sessionSalt: config.sessionSalt || createSessionSalt(),
      ...(!loadedConfig ? { onboardingPending: true } : {}),
      enabledSources: [...enabled].sort(),
      sourceOptions,
    }, { [sourceId]: config?.apiKey ? 'private' : 'local' }));
    console.log(`已启用 ${sourceId}。`);
    return;
  }
  if (action === 'disable') {
    enabled.delete(sourceId);
    delete sourceOptions[sourceId];
    saveConfig(applySourcePolicies({
      ...config,
      sessionSalt: config.sessionSalt || createSessionSalt(),
      ...(!loadedConfig ? { onboardingPending: true } : {}),
      enabledSources: [...enabled].sort(),
      sourceOptions,
    }, { [sourceId]: 'off' }));
    console.log(`已停用 ${sourceId}；远端历史数据未删除。`);
    return;
  }
  throw new Error(`未知 sources 操作: ${action}`);
}
