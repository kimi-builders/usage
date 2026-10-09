import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLimitSettings, publicLimitSettings } from '../../src/limits/catalog.js';
import { saveLimitSettings } from '../../src/limits/service.js';
import { createLimitSettingsState, isLimitSettingsDirty, limitSettingsReducer as reduce } from '../src/limit-settings-state.js';

const clone = value => structuredClone(value);
function fixture() {
  return publicLimitSettings(normalizeLimitSettings({ enabled: true, providers: {
    'kimi-code': { enabled: true, accountsInitialized: true, accounts: [
      { id: 'personal', label: 'Personal', connectionType: 'api-key', authMode: 'keychain', subscriptionPrice: 99, entitlementType: 'paid' },
    ] },
    copilot: { enabled: true, accounts: [{ id: 'old', label: 'Old account' }], activeAccountId: 'old' },
  } }), { keychainAvailable: true, hasSecret: () => true });
}
const edit = (state, field, value) => reduce(state, { type: 'edit', field, value });
const receive = (state, settings) => reduce(state, { type: 'receive', settings });

test('detection updates reach the catalog without marking an untouched form dirty', () => {
  const initial = fixture();
  const detected = clone(initial);
  detected.catalog.find(item => item.id === 'codex').detection = { state: 'detected', label: 'Detected' };
  const next = receive(createLimitSettingsState(initial), detected);
  assert.deepEqual(next.draft.catalog, detected.catalog);
  assert.equal(isLimitSettingsDirty(next), false);
});

test('server detection and credential metadata rebase without erasing edits or secret drafts', () => {
  const initial = fixture();
  let state = edit(createLimitSettingsState(initial), 'draft', draft => ({ ...draft, refreshMinutes: 30 }));
  state = edit(state, 'accountSecrets', { 'kimi-code': { personal: 'fixture-new-key' } });
  const detected = clone(initial);
  detected.providers['kimi-code'].accounts[0].hasSecret = false;
  detected.providers['kimi-code'].accounts[0].credentialState = 'absent';
  const next = receive(state, detected);
  assert.equal(next.draft.refreshMinutes, 30);
  assert.equal(next.draft.providers['kimi-code'].accounts[0].hasSecret, false);
  assert.deepEqual(next.accountSecrets, state.accountSecrets);
  assert.equal(isLimitSettingsDirty(next), true);
});

test('OAuth additions merge by ID while preserving edited accounts, explicit removals, and provider order', () => {
  const initial = fixture();
  const draft = clone(initial);
  draft.providers.copilot.accounts = [];
  draft.providers['kimi-code'].accounts[0].label = 'Unsaved name';
  draft.providerOrder.reverse();
  const incoming = clone(initial);
  incoming.providers.copilot.accounts.push({ id: 'new', label: 'New authorization', hasSecret: true });
  incoming.providers.copilot.activeAccountId = 'new';
  const next = receive(edit(createLimitSettingsState(initial), 'draft', draft), incoming);
  assert.deepEqual(next.draft.providers.copilot.accounts.map(a => a.id), ['new']);
  assert.equal(next.draft.providers.copilot.activeAccountId, 'new');
  assert.equal(next.draft.providers['kimi-code'].accounts[0].label, 'Unsaved name');
  assert.deepEqual(next.draft.providerOrder, draft.providerOrder);
});

test('editing an existing account does not lose new accounts or mix their metadata', () => {
  const initial = fixture();
  const draft = clone(initial);
  draft.providers.copilot.accounts[0].label = 'Edited locally';
  const incoming = clone(initial);
  incoming.providers.copilot.accounts.unshift({ id: 'new', label: 'New authorization', hasSecret: true });
  incoming.providers.copilot.accounts[1].credentialState = 'present';
  const next = receive(edit(createLimitSettingsState(initial), 'draft', draft), incoming);
  assert.equal(next.draft.providers.copilot.accounts.find(a => a.id === 'old').label, 'Edited locally');
  assert.equal(next.draft.providers.copilot.accounts.find(a => a.id === 'new').label, 'New authorization');
});

test('normal save after device authorization retains the account and its credential in the actual settings service', () => {
  const initial = fixture();
  let state = edit(createLimitSettingsState(initial), 'draft', draft => ({ ...draft, refreshMinutes: 30 }));
  const connected = clone(initial);
  connected.providers.copilot.accounts.push({ id: 'new', label: 'New GitHub account' });
  let config = { sessionSalt: 'test-only', subscriptionLimits: normalizeLimitSettings(connected) };
  const keys = new Map([['copilot:old', 'old-fixture'], ['copilot:new', 'new-fixture'], ['kimi-code:personal', 'kimi-fixture']]);
  state = receive(state, publicLimitSettings(config.subscriptionLimits, { hasSecret: key => keys.has(key) }));
  saveLimitSettings({ settings: state.draft }, {
    config, save: next => { config = next; },
    writeSecret: (key, value) => keys.set(key, value), deleteSecret: key => keys.delete(key),
  });
  assert.deepEqual(config.subscriptionLimits.providers.copilot.accounts.map(a => a.id), ['old', 'new']);
  assert.equal(keys.get('copilot:new'), 'new-fixture');
  assert.equal(config.subscriptionLimits.refreshMinutes, 30);
});

test('an external account removal is not resurrected by a local metadata edit', () => {
  const initial = fixture();
  const draft = clone(initial);
  draft.providers.copilot.accounts[0].label = 'Draft label';
  const incoming = clone(initial);
  incoming.providers.copilot.accounts = [];
  const next = receive(edit(createLimitSettingsState(initial), 'draft', draft), incoming);
  assert.deepEqual(next.draft.providers.copilot.accounts, []);
});

test('successful save adopts normalized settings and clears submitted secrets and removal flags', () => {
  const initial = fixture();
  const draft = clone(initial);
  draft.providers['kimi-code'].accounts[0].label = '  Renamed  ';
  let state = edit(createLimitSettingsState(initial), 'draft', draft);
  state = edit(state, 'secrets', { cursor: 'fixture-cookie' });
  state = edit(state, 'accountSecrets', { 'kimi-code': { personal: 'fixture-key' } });
  state = edit(state, 'clearSecrets', ['cursor']);
  state = edit(state, 'clearAccountSecrets', ['copilot:old']);
  const savedSettings = publicLimitSettings(normalizeLimitSettings(draft), { hasSecret: () => true });
  const saved = reduce(state, { type: 'saved', submitted: state, settings: savedSettings });
  assert.equal(saved.draft.providers['kimi-code'].accounts[0].label, 'Renamed');
  assert.deepEqual(saved.secrets, {});
  assert.deepEqual(saved.accountSecrets, {});
  assert.deepEqual(saved.clearSecrets, []);
  assert.deepEqual(saved.clearAccountSecrets, []);
  assert.equal(isLimitSettingsDirty(saved), false);
  assert.equal(isLimitSettingsDirty(receive(saved, clone(savedSettings))), false);
});

test('save acknowledgment also works when the new settings prop arrives before the acknowledgment', () => {
  const initial = fixture();
  const submitted = edit(createLimitSettingsState(initial), 'accountSecrets', { 'kimi-code': { personal: 'fixture-key' } });
  const incoming = clone(initial);
  incoming.providers['kimi-code'].accounts[0].credentialState = 'present';
  const next = reduce(receive(submitted, incoming), { type: 'saved', settings: incoming, submitted });
  assert.equal(isLimitSettingsDirty(next), false);
});

test('edits and secrets entered after a submitted snapshot are not discarded by its acknowledgment', () => {
  const initial = fixture();
  const submitted = edit(createLimitSettingsState(initial), 'accountSecrets', { 'kimi-code': { personal: 'first-fixture' } });
  let current = edit(submitted, 'accountSecrets', { 'kimi-code': { personal: 'newer-fixture' } });
  current = edit(current, 'draft', draft => ({ ...draft, refreshMinutes: 60 }));
  const next = reduce(current, { type: 'saved', settings: initial, submitted });
  assert.equal(next.accountSecrets['kimi-code'].personal, 'newer-fixture');
  assert.equal(next.draft.refreshMinutes, 60);
  assert.equal(isLimitSettingsDirty(next), true);
});

test('failed writes preserve all drafts; closing/reopening discards secrets explicitly', () => {
  const initial = fixture();
  const state = edit(createLimitSettingsState(initial), 'secrets', { cursor: 'fixture-secret' });
  assert.equal(reduce(state, { type: 'failed' }), state);
  assert.equal(isLimitSettingsDirty(state), true);
  const reopened = reduce(state, { type: 'reset', settings: initial });
  assert.deepEqual(reopened.secrets, {});
  assert.equal(isLimitSettingsDirty(reopened), false);
});
