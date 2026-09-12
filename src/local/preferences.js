import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getConfigDir } from '../config.js';

// This separate file never enables scanning, quota access, or community sync.
const KEYS = new Set([
  'kbu.theme', 'kbu.vibe', 'kbu.locale', 'kbu.currency.v1',
  'kbu.budget.v1', 'kbu.budget.dismissed.v1', 'kbu.spikes.v1', 'kbu.milestones.v1',
  'kbu.poster.name', 'kbu.poster.handle', 'kbu.poster.avatar.v1',
  'kbu.usage.heat-mode.v1', 'kbu.benefit.heat-mode.v1',
  'kbu.benefit.selected.v1', 'kbu.benefit.accounts.v1',
  'kbu.benefit.activity-range.v1', 'kbu.benefit.distribution-range.v1', 'kbu.benefit.records-range.v1',
]);

function validate(values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw invalid();
  for (const [key, value] of Object.entries(values)) {
    if (!KEYS.has(key) || (value !== null && (typeof value !== 'string'
      || value.length > (key === 'kbu.poster.avatar.v1' ? 256 * 1024 : 16 * 1024)))) throw invalid();
    if (key === 'kbu.poster.avatar.v1' && value && !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) throw invalid();
  }
  return values;
}

function invalid() { return Object.assign(new Error('Invalid local preferences.'), { code: 'invalid_preferences' }); }

export function createPreferencesStore(directory = getConfigDir()) {
  const path = join(directory, 'preferences.json');
  const load = () => {
    if (!existsSync(path)) return {};
    // Do not silently overwrite an unreadable file with defaults.
    return validate(JSON.parse(readFileSync(path, 'utf8')));
  };
  return {
    load,
    save(patch, { onlyMissing = false } = {}) {
      validate(patch);
      const next = { ...load() };
      for (const [key, value] of Object.entries(patch)) {
        if (!onlyMissing || !Object.hasOwn(next, key)) next[key] = value;
      }
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
      try {
        writeFileSync(temporary, `${JSON.stringify(next)}\n`, { mode: 0o600, flag: 'wx' });
        renameSync(temporary, path);
      } finally { if (existsSync(temporary)) unlinkSync(temporary); }
      return next;
    },
  };
}
