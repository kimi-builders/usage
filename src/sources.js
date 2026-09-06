import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSessionSalt, loadConfig, saveConfig } from './config.js';
import { sourceRegistry } from './parsers/index.js';
import { applySourcePolicies, effectiveSourcePolicies, isSourceMode } from './source-policy.js';
import { c, getLocale, renderTable, t } from './cli-ui.js';
import {
  configuredExtraRoots, extraRootId, normalizeExtraRoot, supportsExtraRoots,
} from './extra-roots.js';

function option(args, name) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(getLocale() === 'zh' ? `--${name} 需要一个值。` : `--${name} requires a value.`);
  }
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
    if (!source) throw new Error(isZh
      ? `数据源不存在: ${sourceId || '(missing)'}`
      : `Data source does not exist: ${sourceId || '(missing)'}`);
    if (!isSourceMode(mode)) throw new Error(isZh
      ? '模式必须是 off、local 或 private。'
      : 'Mode must be off, local, or private.');
    if (sourceId === 'cursor' && mode !== 'off' && !config.sourceOptions?.cursor?.csvPath) {
      throw new Error(isZh
        ? 'Cursor 需要先运行 `sources enable cursor --csv PATH` 配置导出的 usage CSV。'
        : 'Configure an exported Cursor usage CSV with `sources enable cursor --csv PATH` first.');
    }
    const next = applySourcePolicies({
      ...config,
      sessionSalt: config.sessionSalt || createSessionSalt(),
      ...(!loadedConfig ? { onboardingPending: true } : {}),
    }, { [sourceId]: mode });
    saveConfig(next);
    const modeLabel = isZh
      ? { off: '关闭', local: '仅本机扫描', private: '本机扫描并同步' }[mode]
      : { off: 'off', local: 'local scanning only', private: 'local scanning and sync' }[mode];
    console.log(isZh
      ? `${sourceId} 已设为 ${modeLabel}；远端历史数据未删除。`
      : `${sourceId} set to ${modeLabel}; remote history was not deleted.`);
    return;
  }
  if (['add-root', 'remove-root'].includes(action)) {
    if (!sourceRegistry.some((item) => item.id === sourceId) || !supportsExtraRoots(sourceId)) {
      throw new Error(isZh
        ? `该数据源不支持额外目录: ${sourceId || '(missing)'}`
        : `This source does not support extra directories: ${sourceId || '(missing)'}`);
    }
    const sourceOptions = { ...(config.sourceOptions || {}) };
    const current = configuredExtraRoots(sourceOptions, sourceId);
    if (action === 'add-root') {
      const path = normalizeExtraRoot(args[2]);
      if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
        throw new Error(isZh
          ? '请提供一个存在的绝对目录路径。'
          : 'Provide an existing absolute directory path.');
      }
      sourceOptions[sourceId] = {
        ...(sourceOptions[sourceId] || {}),
        extraRoots: [...new Set([...current, path])],
      };
      saveConfig({
        ...config,
        sessionSalt: config.sessionSalt || createSessionSalt(),
        ...(!loadedConfig ? { onboardingPending: true } : {}),
        sourceOptions,
      });
      console.log(isZh
        ? `已为 ${sourceId} 添加额外数据目录。完整路径只保存在本机。`
        : `Added an extra data directory for ${sourceId}. The full path stays on this device.`);
      return;
    }
    const target = String(args[2] || '').trim();
    const normalized = normalizeExtraRoot(target);
    const nextRoots = current.filter((path) => path !== normalized && extraRootId(path) !== target);
    if (nextRoots.length === current.length) {
      throw new Error(isZh
        ? '没有找到要移除的额外数据目录。'
        : 'No matching extra data directory was found.');
    }
    sourceOptions[sourceId] = { ...(sourceOptions[sourceId] || {}), extraRoots: nextRoots };
    saveConfig({ ...config, sourceOptions });
    console.log(isZh
      ? `已移除 ${sourceId} 的额外数据目录。`
      : `Removed the extra data directory for ${sourceId}.`);
    return;
  }
  const source = optional.find((item) => item.id === sourceId);
  if (!source) throw new Error(isZh
    ? `可显式配置的数据源不存在: ${sourceId || '(missing)'}`
    : `Explicitly configurable data source does not exist: ${sourceId || '(missing)'}`);

  const sourceOptions = { ...(config.sourceOptions || {}) };
  if (action === 'enable') {
    if (sourceId === 'cursor') {
      const csv = option(args, 'csv');
      if (!csv) throw new Error(isZh
        ? '启用 Cursor 需要 --csv PATH（Cursor Dashboard 主动导出的 usage CSV）。'
        : 'Enabling Cursor requires --csv PATH (a usage CSV exported from Cursor Dashboard).');
      const csvPath = resolve(csv);
      if (!existsSync(csvPath) || !statSync(csvPath).isFile()) {
        throw new Error(isZh
          ? `Cursor CSV 不存在或不是文件: ${csvPath}`
          : `Cursor CSV does not exist or is not a file: ${csvPath}`);
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
    console.log(isZh ? `已启用 ${sourceId}。` : `Enabled ${sourceId}.`);
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
    console.log(isZh
      ? `已停用 ${sourceId}；远端历史数据未删除。`
      : `Disabled ${sourceId}; remote history was not deleted.`);
    return;
  }
  throw new Error(isZh ? `未知 sources 操作: ${action}` : `Unknown sources action: ${action}`);
}
