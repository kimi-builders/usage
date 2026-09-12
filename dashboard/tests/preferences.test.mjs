import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreferences } from '../src/preferences.js';

test('new browser origins restore server preferences and migrate legacy values only once', async () => {
  let server = { 'kbu.theme': 'light', 'kbu.budget.v1': null };
  const request = async (_url, options) => {
    if (options.method === 'POST') {
      const { values, onlyMissing } = JSON.parse(options.body);
      for (const [key, value] of Object.entries(values)) if (!onlyMissing || !Object.hasOwn(server, key)) server[key] = value;
    }
    return { ok: true, json: async () => ({ ...server }) };
  };
  const first = createPreferences({ request, legacy: { getItem: (key) => ({ 'kbu.theme': 'dark', 'kbu.budget.v1': 'old target', 'kbu.poster.name': 'Builder' })[key] ?? null } });
  await first.initialize();
  assert.equal(first.getItem('kbu.theme'), 'light');
  assert.equal(first.getItem('kbu.budget.v1'), null);
  await first.setItem('kbu.budget.v1', '{"metric":"tokens","target":123}');
  await Promise.all([first.setItem('kbu.theme', 'dark'), first.setItem('kbu.theme', 'light')]);
  const restarted = createPreferences({ request, legacy: null });
  await restarted.initialize();
  assert.equal(restarted.getItem('kbu.budget.v1'), '{"metric":"tokens","target":123}');
  assert.equal(restarted.getItem('kbu.poster.name'), 'Builder');
  assert.equal(restarted.getItem('kbu.theme'), 'light');
});

test('failed preference writes reject for budget feedback and notify other controls', async () => {
  let errors = 0;
  const store = createPreferences({ legacy: null, onError: () => errors++, request: async (_url, options) => ({ ok: options.method !== 'POST', json: async () => ({ 'kbu.theme': 'dark' }) }) });
  await store.initialize();
  await assert.rejects(store.setItem('kbu.theme', 'light'));
  assert.equal(store.getItem('kbu.theme'), 'dark');
  assert.equal(errors, 1);
});

test('queued writes roll back to the last server-confirmed value through mixed outcomes', async () => {
  for (const [outcomes, expected] of [
    [[false, false], 'dark'], [[true, false], 'light'],
    [[false, true], 'poster'], [[true, true], 'poster'],
  ]) {
    let server = { 'kbu.theme': 'dark' };
    const store = createPreferences({ legacy: null, request: async (_url, options) => {
      if (options.method === 'POST') {
        if (!outcomes.shift()) return { ok: false };
        server = { ...server, ...JSON.parse(options.body).values };
      }
      return { ok: true, json: async () => ({ ...server }) };
    } });
    await store.initialize();
    await Promise.allSettled([store.setItem('kbu.theme', 'light'), store.setItem('kbu.theme', 'poster')]);
    assert.equal(store.getItem('kbu.theme'), expected);
    assert.equal(store.getItem('kbu.theme'), server['kbu.theme']);
  }
});

test('an older failure cannot roll back a newer optimistic write with the same value', async () => {
  const writes = [];
  const store = createPreferences({ legacy: null, request: async (_url, options) => {
    if (options.method !== 'POST') return { ok: true, json: async () => ({ 'kbu.theme': 'dark' }) };
    return new Promise((resolve) => writes.push(resolve));
  } });
  await store.initialize();
  const results = Promise.allSettled([
    store.setItem('kbu.theme', 'light'), store.setItem('kbu.theme', 'poster'), store.setItem('kbu.theme', 'light'),
  ]);
  for (let index = 0; index < 3; index++) {
    await new Promise(setImmediate);
    assert.equal(store.getItem('kbu.theme'), 'light');
    writes[index]({ ok: false });
  }
  await results;
  assert.equal(store.getItem('kbu.theme'), 'dark');
});

test('confirmed deletion and other keys survive subsequent failed writes', async () => {
  let server = { 'kbu.theme': 'dark', 'kbu.locale': 'en' };
  const outcomes = [true, true, false, false];
  const store = createPreferences({ legacy: null, request: async (_url, options) => {
    if (options.method === 'POST') {
      if (!outcomes.shift()) throw new Error('offline');
      server = { ...server, ...JSON.parse(options.body).values };
    }
    return { ok: true, json: async () => ({ ...server }) };
  } });
  await store.initialize();
  await Promise.allSettled([
    store.removeItem('kbu.theme'), store.setItem('kbu.locale', 'zh'),
    store.setItem('kbu.theme', 'light'), store.removeItem('kbu.locale'),
  ]);
  assert.equal(store.getItem('kbu.theme'), null);
  assert.equal(store.getItem('kbu.locale'), 'zh');
});
