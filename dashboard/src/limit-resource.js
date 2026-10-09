// Current quota evidence belongs to a saved connection, not merely a provider
// name. Secret values are never retained here or used as browser identities.
const CONNECTION_FIELDS = ['authMode', 'connectionType', 'environmentVariable',
  'site', 'workspaceId', 'customPath', 'externalIdentifier', 'legacyCredential'];
const connection = (value) => CONNECTION_FIELDS.map(key => value?.[key] ?? null);
const sameConnection = (left, right) => JSON.stringify(connection(left)) === JSON.stringify(connection(right));
const entered = value => typeof value === 'string' ? Boolean(value.trim())
  : value && typeof value === 'object' && Object.values(value).some(entered);

function connectionKey(settings) {
  return JSON.stringify([settings?.enabled, Object.entries(settings?.providers || {}).map(([id, item]) =>
    [id, item.enabled, connection(item), (item.accounts || []).map(account => [account.id, connection(account)])])]);
}

function pending(provider, account) {
  return { id: provider.id, label: provider.label, quotaCoverage: provider.quotaCoverage,
    ...(account ? { accountId: account.id, accountLabel: account.label } : {}),
    status: 'error', quotaInvalidated: true, updatedAt: null, windows: [],
    error: { code: 'refresh_required', message: '连接已更改，等待重新读取此账号的额度。' } };
}

export function reconcileLimitSnapshot(data, settings, previous = null, payload = {}) {
  // Analytics may also receive a partial metadata-only settings object.
  if (!data || !settings?.providers || typeof settings.enabled !== 'boolean') return data;
  const catalog = new Map((settings.catalog || []).map(item => [item.id, item]));
  const cached = new Map((data.providers || []).map(item => [item.id, item]));
  const providers = settings.enabled === false ? [] : (settings.providerOrder || Object.keys(settings.providers))
    .filter(id => settings.providers[id]?.enabled).map(id => {
      const item = settings.providers[id];
      const prior = previous?.providers?.[id];
      const old = cached.get(id);
      const descriptor = { ...catalog.get(id), id, label: catalog.get(id)?.label || old?.label || id };
      const providerChanged = previous && (!prior?.enabled || !sameConnection(prior, item))
        // A newly typed private path may sanitize to the same display string.
        // Compare the submitted connection too, without retaining its path.
        || prior && payload.settings?.providers?.[id] && !sameConnection(prior, payload.settings.providers[id])
        || entered(payload.secrets?.[id]) || payload.clearSecrets?.includes(id);
      if (item.accounts?.length) {
        const accounts = item.accounts.map(account => {
          const saved = prior?.accounts?.find(value => value.id === account.id);
          const evidence = old?.accounts?.find(value => value.accountId === account.id);
          const credentialKey = id === 'kimi-code' && account.legacyCredential ? id : `${id}:${account.id}`;
          const changed = providerChanged || previous && (!saved || !sameConnection(saved, account))
            || entered(payload.accountSecrets?.[id]?.[account.id])
            || payload.clearAccountSecrets?.includes(credentialKey);
          return !evidence || changed ? pending(descriptor, account)
            : { ...evidence, accountLabel: account.label };
        });
        const activeId = previous && prior?.activeAccountId !== item.activeAccountId
          ? item.activeAccountId : old?.activeAccountId || item.activeAccountId;
        const active = accounts.find(account => account.accountId === activeId) || accounts[0];
        // A removed duplicate owner must not suppress a still-configured key.
        // Its ownership cannot be reverified until a fresh query succeeds.
        const verifiedOwners = new Set(accounts.filter(account => !account.quotaInvalidated).map(account => account.accountId));
        for (let index = 0; index < accounts.length; index += 1) {
          if (accounts[index].duplicateOf && !verifiedOwners.has(accounts[index].duplicateOf)) accounts[index] = pending(descriptor, item.accounts[index]);
        }
        const selected = accounts.find(account => account.accountId === active.accountId) || accounts[0];
        return { ...selected, id, label: descriptor.label, accounts, activeAccountId: selected.accountId,
          quotaCoverage: descriptor.quotaCoverage || old?.quotaCoverage };
      }
      // Switching from manual accounts to local login must not borrow the old
      // selected account's quota or identity, even if the provider is unchanged.
      return !old || providerChanged || old.accounts?.length ? pending(descriptor) : old;
    });
  return { ...data, enabled: settings.enabled ?? data.enabled, refreshMinutes: settings.refreshMinutes ?? data.refreshMinutes,
    providers, summary: { configured: providers.length,
      available: providers.filter(provider => provider.status === 'ok').length,
      needsAttention: providers.filter(provider => provider.status === 'error').length,
      nextResetAt: providers.flatMap(provider => provider.windows || []).map(window => window.resetsAt)
        .filter(value => value && Date.parse(value) > Date.now()).sort()[0] || null } };
}

// The same request coordinator drives the UI and deferred-response tests.
// A response issued before a saved connection change can never restore it.
export function createLimitResource({ fetcher = fetch, onData, onSettings, onLoading,
  onError, onSettingsLoading, onSettingsError }) {
  let data = null;
  let settings = null;
  let quotaRequest = 0;
  let settingsRequest = 0;
  const acceptSettings = (next, payload) => {
    if (settings && connectionKey(settings) !== connectionKey(next) || entered(payload?.secrets)
      || entered(payload?.accountSecrets) || payload?.clearSecrets?.length || payload?.clearAccountSecrets?.length) {
      quotaRequest += 1;
      onLoading(false);
    }
    data = reconcileLimitSnapshot(data, next, settings, payload);
    settings = next;
    onSettings(next);
    onData(data);
  };
  const load = async (refresh = false) => {
    const request = ++quotaRequest;
    onLoading(true); onError('');
    try {
      const response = await fetcher(`/api/limits${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`Limit request failed (${response.status})`);
      const next = await response.json();
      if (request !== quotaRequest) return null;
      data = reconcileLimitSnapshot(next, settings);
      onData(data);
      return data;
    } catch (reason) {
      if (request === quotaRequest) onError(reason?.message || String(reason));
      return null;
    } finally { if (request === quotaRequest) onLoading(false); }
  };
  const loadSettings = async ({ detectCredentials = false } = {}) => {
    const request = ++settingsRequest;
    onSettingsLoading(true); onSettingsError('');
    try {
      const response = await fetcher(`/api/limits/settings${detectCredentials ? '?detect=1' : ''}`, { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error(`Limit settings request failed (${response.status})`);
      const next = await response.json();
      if (request !== settingsRequest) return null;
      acceptSettings(next);
      return next;
    } catch (reason) {
      if (request === settingsRequest) onSettingsError(reason?.message || String(reason));
      return null;
    } finally { if (request === settingsRequest) onSettingsLoading(false); }
  };
  const save = async (payload, { onSaved } = {}) => {
    settingsRequest += 1;
    onSettingsLoading(false);
    const response = await fetcher('/api/limits/settings', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) throw new Error(await response.text() || `Settings save failed (${response.status})`);
    const next = await response.json();
    acceptSettings(next, payload);
    onSettingsLoading(false); onSettingsError('');
    onSaved?.(next);
    return load(true);
  };
  return { load, loadSettings, save };
}
