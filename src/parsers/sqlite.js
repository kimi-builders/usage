import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Run a SQL query against a SQLite database and return rows as plain objects
 * (column name → value), mirroring the shape of `sqlite3 -json` output.
 *
 * Prefers Node's built-in `node:sqlite` (>= 22.5, no external binary needed).
 * Falls back to shelling out to the `sqlite3` CLI on older Node. If neither
 * is available, throws an Error whose message contains "ENOENT" so callers
 * can treat the SQLite path as unusable without crashing the whole sync.
 */
export function queryDbJson(dbPath, sql, {
  timeout = 30000, maxBuffer = 100 * 1024 * 1024, readOnly = true,
} = {}) {
  const db = openNodeSqlite(dbPath, readOnly);
  if (db) {
    try {
      return db.prepare(sql).all();
    } finally {
      db.close();
    }
  }
  return queryViaCli(dbPath, sql, { timeout, maxBuffer });
}

function isLockError(error) {
  return /database is locked/i.test(error?.message || '');
}

function querySnapshot(dbPath, sql, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), `${options.tempPrefix || 'kbu-sqlite'}-`));
  const snapshot = join(directory, basename(dbPath));
  try {
    copyFileSync(dbPath, snapshot);
    for (const suffix of ['-shm', '-wal']) {
      if (existsSync(`${dbPath}${suffix}`)) copyFileSync(`${dbPath}${suffix}`, `${snapshot}${suffix}`);
    }
    return queryDbJson(snapshot, sql, { ...options, readOnly: false });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function queryDbJsonSnapshotOnLock(dbPath, sql, options = {}) {
  try {
    return queryDbJson(dbPath, sql, options);
  } catch (error) {
    if (!isLockError(error)) throw error;
    return querySnapshot(dbPath, sql, options);
  }
}

let nodeSqlite; // undefined = not tried, null = unavailable

function getNodeSqlite() {
  if (nodeSqlite !== undefined) return nodeSqlite;
  try {
    // Suppress the one-time "SQLite is an experimental feature" warning on
    // Node versions where node:sqlite is still flagged experimental.
    const prevEmit = process.emitWarning;
    process.emitWarning = (warning, ...rest) => {
      const opts = rest[0];
      const type = typeof opts === 'object' && opts ? opts.type : opts;
      const name = typeof warning === 'object' && warning ? warning.name : undefined;
      if ((type === 'ExperimentalWarning' || name === 'ExperimentalWarning') && String(warning).includes('SQLite')) return;
      return prevEmit.call(process, warning, ...rest);
    };
    try {
      nodeSqlite = require('node:sqlite');
    } finally {
      process.emitWarning = prevEmit;
    }
  } catch {
    nodeSqlite = null;
  }
  return nodeSqlite;
}

function openNodeSqlite(dbPath, readOnly = true) {
  const mod = getNodeSqlite();
  if (!mod || !mod.DatabaseSync) return null;
  try {
    const db = new mod.DatabaseSync(dbPath, { readOnly });
    if (!readOnly) db.exec('PRAGMA query_only = ON');
    return db;
  } catch {
    return null;
  }
}

function queryViaCli(dbPath, sql, { timeout, maxBuffer }) {
  const out = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf-8',
    maxBuffer,
    timeout,
  });
  const trimmed = out.trim();
  if (!trimmed || trimmed === '[]') return [];
  return JSON.parse(trimmed);
}
