import { loadConfig } from './config.js';
import { LIMIT_PROVIDER_CATALOG } from './limits/catalog.js';
import {
  clearLimitCache,
  getLimitSettings,
  getPublicLimitSettings,
  loadSubscriptionLimits,
} from './limits/service.js';
import {
  c,
  formatCurrency,
  formatDuration,
  formatNumber,
  formatPercent,
  getLocale,
  pad,
  renderProgressBar,
  renderStatusBadge,
  stringWidth,
  t,
} from './cli-ui.js';

const PROVIDER_ALIASES = {
  claude: 'claude-code',
  'claude-code': 'claude-code',
  kimi: 'kimi-code',
  'kimi-code': 'kimi-code',
  codex: 'codex',
  cursor: 'cursor',
  copilot: 'copilot',
  'github-copilot': 'copilot',
  github: 'copilot',
  antigravity: 'antigravity',
  agy: 'antigravity',
  deepseek: 'deepseek',
  opencode: 'opencode',
  qoder: 'qoder',
  warp: 'warp',
  jetbrains: 'jetbrains-ai',
  'jetbrains-ai': 'jetbrains-ai',
};

export function normalizeProviderId(name) {
  if (!name) return null;
  const clean = String(name).toLowerCase().trim();
  return PROVIDER_ALIASES[clean] || clean;
}

export function formatResetCountdown(resetsAt) {
  if (!resetsAt) return null;
  const target = Date.parse(resetsAt);
  if (!Number.isFinite(target)) return null;
  const diffSec = Math.max(0, Math.round((target - Date.now()) / 1000));
  const isZh = getLocale() === 'zh';
  if (diffSec <= 60) {
    return isZh ? '即将重置' : 'resets shortly';
  }
  const durationStr = formatDuration(diffSec, { short: true });
  const timeDate = new Date(target);
  const timeStr = `${String(timeDate.getHours()).padStart(2, '0')}:${String(timeDate.getMinutes()).padStart(2, '0')}`;
  return isZh ? `${durationStr} 后重置 (${timeStr})` : `resets in ${durationStr} (${timeStr})`;
}

export async function fetchQuota(options = {}) {
  const config = loadConfig() || {};
  const settings = getLimitSettings(config);
  const publicSettings = getPublicLimitSettings(config);

  const providerFilter = normalizeProviderId(options.provider || options.agent);
  if (providerFilter && !LIMIT_PROVIDER_CATALOG.some((p) => p.id === providerFilter)) {
    throw new Error(`未知的 Provider 或 Agent 标识: ${options.provider || options.agent}`);
  }

  // Determine which providers to query
  const targetSettings = {
    ...settings,
    enabled: true,
    providers: { ...settings.providers },
  };

  if (providerFilter) {
    targetSettings.providerOrder = [providerFilter];
    targetSettings.providers[providerFilter] = {
      ...(targetSettings.providers[providerFilter] || {}),
      enabled: true,
    };
  } else if (options.all) {
    targetSettings.providerOrder = LIMIT_PROVIDER_CATALOG.map((p) => p.id);
    for (const provider of LIMIT_PROVIDER_CATALOG) {
      targetSettings.providers[provider.id] = {
        ...(targetSettings.providers[provider.id] || {}),
        enabled: true,
      };
    }
  } else {
    // Auto-detect providers with active local logins or configured credentials
    const activeProviderIds = new Set();
    for (const item of publicSettings.catalog || []) {
      if (item.detection?.state === 'detected' || item.detection?.state === 'configured') {
        activeProviderIds.add(item.id);
      }
    }
    for (const [id, prov] of Object.entries(publicSettings.providers || {})) {
      if (prov?.enabled) activeProviderIds.add(id);
    }
    if (activeProviderIds.size === 0) {
      // Default to recommended popular ones if nothing configured
      for (const p of ['codex', 'claude-code', 'kimi-code', 'cursor', 'copilot', 'antigravity']) {
        activeProviderIds.add(p);
      }
    }
    targetSettings.providerOrder = LIMIT_PROVIDER_CATALOG
      .map((p) => p.id)
      .filter((id) => activeProviderIds.has(id));
    for (const id of activeProviderIds) {
      targetSettings.providers[id] = {
        ...(targetSettings.providers[id] || {}),
        enabled: true,
      };
    }
  }

  if (options.force) clearLimitCache();

  const queryConfig = {
    ...config,
    subscriptionLimits: targetSettings,
  };

  const result = await loadSubscriptionLimits({
    force: Boolean(options.force || providerFilter),
    config: queryConfig,
  });

  if (providerFilter && Array.isArray(result.providers)) {
    return {
      ...result,
      providers: result.providers.filter((p) => p.id === providerFilter),
      summary: {
        configured: 1,
        available: result.providers.filter((p) => p.id === providerFilter && p.status === 'ok').length,
        needsAttention: result.providers.filter((p) => p.id === providerFilter && p.status === 'error').length,
        nextResetAt: result.providers.filter((p) => p.id === providerFilter).flatMap((p) => p.windows || [])
          .map((w) => w.resetsAt).filter((v) => v && new Date(v) > new Date()).sort()[0] || null,
      },
    };
  }
  return result;
}

export function renderQuotaReport(quotaData) {
  const isZh = getLocale() === 'zh';
  const lines = [];
  const divider = c.dim('─'.repeat(Math.min(74, (process.stdout.columns || 80) - 2)));

  const title = isZh ? '◆ AI 订阅额度与 Quota 状态' : '◆ AI Subscription Quota & Limits';
  const timeStr = quotaData.generatedAt ? `(${new Date(quotaData.generatedAt).toLocaleTimeString()})` : '';
  lines.push(`\n${c.bold(c.cyan(title))} ${c.dim(timeStr)}`);
  lines.push(divider);

  const providers = quotaData.providers || [];
  if (providers.length === 0) {
    lines.push(`  ${c.gray(isZh ? '未检测到可查询额度的 AI 平台。运行 `npx @kimi.builders/usage quota --all` 尝试扫描全部平台。' : 'No quota-enabled providers found. Run `npx @kimi.builders/usage quota --all` to scan all.')}`);
    lines.push(divider + '\n');
    return lines.join('\n');
  }

  for (const provider of providers) {
    const isOk = provider.status === 'ok';
    const planBadge = provider.plan ? ` ${c.bold(c.cyan(`[${provider.plan}]`))}` : '';
    const accountStr = provider.account ? ` ${c.dim(`(${provider.account})`)}` : '';
    const statusBadge = isOk
      ? c.green('✓ 正常')
      : provider.status === 'empty'
        ? c.gray('- 暂无额度数据')
        : c.red('✗ 查询失败');

    lines.push(`  ${c.bold(provider.label)}${planBadge}${accountStr}`);

    if (isOk && Array.isArray(provider.windows) && provider.windows.length > 0) {
      for (const window of provider.windows) {
        const remaining = window.remainingPercent != null
          ? window.remainingPercent
          : window.usedPercent != null
            ? Math.max(0, 100 - window.usedPercent)
            : 100;

        const barColor = remaining <= 15 ? 'red' : remaining <= 40 ? 'yellow' : 'green';
        const progressBar = renderProgressBar(remaining / 100, 14, { color: barColor, showPercent: false });
        const percentText = pad(`${isZh ? '剩余' : 'Rem'}: ${formatPercent(remaining, { decimals: 1, fromFraction: false })}`, 13);

        let detailPart = '';
        if (window.value != null && window.limit != null) {
          const unit = window.unit || '';
          const isCurrency = unit.toLowerCase() === 'usd' || unit.toLowerCase() === 'cny' || unit === '$' || unit === '¥';
          const valStr = isCurrency ? formatCurrency(window.value) : formatNumber(window.value);
          const limitStr = isCurrency ? formatCurrency(window.limit) : formatNumber(window.limit);
          detailPart = ` · ${valStr} / ${limitStr} ${unit}`;
        }

        const countdown = formatResetCountdown(window.resetsAt);
        const countdownStr = countdown ? ` · ⟳ ${countdown}` : '';

        const windowName = pad(window.label || (isZh ? '额度窗口' : 'Quota Window'), 20);
        lines.push(`    ${windowName} ${progressBar}  ${percentText}${c.dim(detailPart)}${c.dim(countdownStr)}`);
      }

      if (provider.resetCredits && provider.resetCredits.availableCount != null) {
        const resetStr = isZh
          ? `• 快速重置包: 剩余 ${provider.resetCredits.availableCount} 次`
          : `• Fast reset credits: ${provider.resetCredits.availableCount} available`;
        lines.push(`    ${c.cyan(resetStr)}`);
      }
    } else if (provider.status === 'error') {
      const errMsg = provider.error?.message || (isZh ? '未检测到有效登录凭据' : 'No valid credentials detected');
      lines.push(`    ${c.red('✗')} ${c.dim(errMsg)}`);
    } else if (isOk && (!provider.windows || provider.windows.length === 0)) {
      lines.push(`    ${c.dim(isZh ? '已连接，未返回多窗口额度数据' : 'Connected, no quota windows reported')}`);
    }

    lines.push('');
  }

  // Summary Footer
  const okCount = providers.filter((p) => p.status === 'ok').length;
  const errorCount = providers.filter((p) => p.status === 'error').length;
  const footerText = isZh
    ? `共检测 ${providers.length} 个平台：${okCount} 个正常 · ${errorCount} 个待登录/配置`
    : `Inspected ${providers.length} providers: ${okCount} ready · ${errorCount} need login/config`;
  lines.push(`  ${c.dim(footerText)}`);
  lines.push(divider + '\n');

  return lines.join('\n');
}

export async function runQuota(options = {}) {
  const quotaData = await fetchQuota(options);
  if (options.json) {
    console.log(JSON.stringify(quotaData, null, 2));
    return quotaData;
  }
  const report = renderQuotaReport(quotaData);
  console.log(report);
  return quotaData;
}
