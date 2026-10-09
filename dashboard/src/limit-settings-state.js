import { hasEnteredSecrets } from './subscription-limits-utils.js';

const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value != null && typeof value === 'object' && !Array.isArray(value);

// Rebase local edits onto a fresh server snapshot. Account arrays merge by identity,
// never by position: a newly authorized account must not become an implicit removal.
export function mergeLimitSettings(base, draft, incoming, field = '') {
  if (equal(base, draft)) return incoming;
  if (field === 'accounts' && Array.isArray(base) && Array.isArray(draft) && Array.isArray(incoming)) {
    const prior = new Map(base.map(account => [account.id, account]));
    const next = new Map(incoming.map(account => [account.id, account]));
    const edited = new Set(draft.map(account => account.id));
    return [
      ...draft.flatMap(account => {
        if (!prior.has(account.id)) return [account];
        if (!next.has(account.id)) return []; // Do not resurrect an externally removed account.
        return [mergeLimitSettings(prior.get(account.id), account, next.get(account.id))];
      }),
      ...incoming.filter(account => !prior.has(account.id) && !edited.has(account.id)),
    ];
  }
  if (object(base) && object(draft) && object(incoming)) {
    return Object.fromEntries([...new Set([...Object.keys(draft), ...Object.keys(incoming)])]
      .map(key => [key, key === 'catalog' ? incoming[key] : mergeLimitSettings(base[key], draft[key], incoming[key], key)]));
  }
  return draft;
}

export function createLimitSettingsState(settings) {
  return { base: settings, draft: settings, secrets: {}, accountSecrets: {}, clearSecrets: [], clearAccountSecrets: [] };
}

function unsubmittedSecrets(current, submitted = {}) {
  return Object.fromEntries(Object.entries(current).flatMap(([key, value]) => {
    if (object(value)) {
      const remaining = unsubmittedSecrets(value, submitted[key]);
      return Object.keys(remaining).length ? [[key, remaining]] : [];
    }
    return equal(value, submitted[key]) ? [] : [[key, value]];
  }));
}

export function limitSettingsReducer(state, action) {
  if (action.type === 'reset') return createLimitSettingsState(action.settings);
  if (action.type === 'edit') return { ...state, [action.field]: typeof action.value === 'function' ? action.value(state[action.field]) : action.value };
  if (action.type === 'receive') return {
    ...state, base: action.settings, draft: mergeLimitSettings(state.base, state.draft, action.settings),
  };
  if (action.type === 'saved') return {
    ...state, base: action.settings,
    draft: mergeLimitSettings(action.submitted.draft, state.draft, action.settings),
    secrets: unsubmittedSecrets(state.secrets, action.submitted.secrets),
    accountSecrets: unsubmittedSecrets(state.accountSecrets, action.submitted.accountSecrets),
    clearSecrets: state.clearSecrets.filter(key => !action.submitted.clearSecrets.includes(key)),
    clearAccountSecrets: state.clearAccountSecrets.filter(key => !action.submitted.clearAccountSecrets.includes(key)),
  };
  return state;
}

export function isLimitSettingsDirty(state) {
  return !equal(state.draft, state.base) || hasEnteredSecrets(state.secrets)
    || hasEnteredSecrets(state.accountSecrets) || state.clearSecrets.length > 0 || state.clearAccountSecrets.length > 0;
}
