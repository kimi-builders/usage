// Backend-owned local preferences survive the dashboard's random launch port.
// Legacy browser values migrate once; persisted null is a deletion tombstone.
function legacyStorage() {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function createPreferences({ request = (...args) => fetch(...args), legacy = legacyStorage(), onError = () => {}, onSaved = () => {} } = {}) {
  let values = {};
  let confirmed = {};
  const revisions = new Map();
  let queue = Promise.resolve();
  let error = false;
  const failed = () => { error = true; onError(); };
  const send = async (body) => {
    const response = await request('/api/preferences', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error('Local preference save failed.');
    return response.json();
  };
  const persist = (key, value) => {
    const revision = (revisions.get(key) || 0) + 1;
    revisions.set(key, revision);
    values[key] = value;
    const pending = queue.then(() => send({ values: { [key]: value } })).then((next) => {
      confirmed[key] = next[key];
      if (revisions.get(key) === revision) values[key] = confirmed[key];
      error = false;
      onSaved();
      return next;
    });
    queue = pending.catch(() => {
      if (revisions.get(key) === revision) values[key] = confirmed[key];
      failed();
    });
    return pending;
  };
  return {
    get error() { return error; },
    async initialize() {
      const response = await request('/api/preferences', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) throw new Error('Local preferences could not be loaded.');
      values = await response.json();
      const migration = {};
      try {
        for (const key of [
          'kbu.theme', 'kbu.vibe', 'kbu.locale', 'kbu.currency.v1', 'kbu.budget.v1', 'kbu.budget.dismissed.v1',
          'kbu.spikes.v1', 'kbu.milestones.v1', 'kbu.poster.name', 'kbu.poster.handle', 'kbu.poster.avatar.v1',
          'kbu.usage.heat-mode.v1', 'kbu.benefit.heat-mode.v1', 'kbu.benefit.selected.v1', 'kbu.benefit.accounts.v1',
          'kbu.benefit.activity-range.v1', 'kbu.benefit.distribution-range.v1', 'kbu.benefit.records-range.v1',
        ]) {
          const value = legacy?.getItem(key);
          if (!Object.hasOwn(values, key) && value !== null && value !== undefined) migration[key] = value;
        }
      } catch { /* Browser storage may be disabled; backend remains authoritative. */ }
      if (Object.keys(migration).length) {
        try { values = await send({ values: migration, onlyMissing: true }); }
        catch { failed(); }
      }
      confirmed = { ...values };
    },
    getItem: (key) => values[key] ?? null,
    setItem: persist,
    removeItem: (key) => persist(key, null),
  };
}

export const preferences = createPreferences({ onError: () => {
  globalThis.dispatchEvent?.(new Event('kbu-preference-error'));
}, onSaved: () => {
  globalThis.dispatchEvent?.(new Event('kbu-preference-saved'));
} });
