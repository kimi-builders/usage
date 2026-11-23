import { jsonlRecords } from './jsonl-records.js';
import { readdirSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { join, basename, dirname, posix, win32 } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { aggregateToBuckets, extractSessions } from './index.js';

/**
 * Kimi Code CLI parser. MoonshotAI/kimi-cli (a.k.a. "Kimi Code").
 *
 * Two on-disk layouts are supported:
 *
 * 1. Current ("~/.kimi-code", protocol >= 1.4). Sessions live at
 *      ~/.kimi-code/sessions/wd_<slug>_<hash>/session_<id>/agents/<agentId>/wire.jsonl
 *    Each line is a self-describing event with a top-level integer-ms `time`:
 *      {"type":"usage.record","model":"kimi-code/kimi-for-coding",
 *       "usage":{"inputOther","output","inputCacheRead","inputCacheCreation"},
 *       "usageScope":"turn","time":<ms>}
 *    `usage.record` events are per-step deltas (one per assistant step), so they
 *    sum to the session total. The model name rides on each record — no config
 *    lookup needed. User turns are `turn.prompt` with origin.kind === "user".
 *    The real working directory per session is recorded in
 *      ~/.kimi-code/session_index.jsonl  -> {sessionId, sessionDir, workDir}
 *    which gives an accurate project name (last path component of workDir).
 *
 * 2. Legacy ("~/.kimi", protocol 1.1 / 1.9). Sessions live at
 *      ~/.kimi/sessions/<md5(workdir)>/<session-id>/wire.jsonl
 *    with a different envelope (StatusUpdate.payload.token_usage, float-second
 *    `timestamp`) and the model in ~/.kimi/config.toml. Kept for users who have
 *    not migrated; see parseLegacyKimi() below.
 *
 * Both stores are always parsed and merged. `kimi migrate` translates legacy
 * context.jsonl into the new wire format but DROPS the `_usage` records, so
 * historical token usage only ever exists in the legacy store — parsing both
 * cannot double-count, while skipping legacy whenever ~/.kimi-code has any
 * session silently loses a migrated user's entire history.
 */

// ---------------------------------------------------------------------------
// Current format: ~/.kimi-code
// ---------------------------------------------------------------------------

// KBU_USAGE_KIMI_CODE_DIR overrides the root (test hook). Otherwise resolve
// the data root the same way the CLI itself does: $KIMI_CODE_HOME, then
// ~/.kimi-code. Ignoring KIMI_CODE_HOME means users with a custom home get
// zero usage parsed.
export function currentKimiHomes({ environment = process.env, home = homedir(), platform = process.platform,
  purpose = 'scan', sourceOptions } = {}) {
  const p = platform === 'win32' ? win32 : posix;
  if (environment.KBU_USAGE_KIMI_CODE_DIR?.trim()) return [environment.KBU_USAGE_KIMI_CODE_DIR.trim()];
  const cli = environment.KIMI_CODE_HOME?.trim() || p.join(home, '.kimi-code');
  // A pre-existing private policy covered the CLI, never the Work desktop store.
  if (purpose === 'sync' && sourceOptions?.['kimi-code']?.syncDesktop !== true) return [cli];
  const config = platform === 'darwin' ? p.join(home, 'Library', 'Application Support')
    : platform === 'win32' ? environment.APPDATA || p.join(home, 'AppData', 'Roaming')
    : environment.XDG_CONFIG_HOME || p.join(home, '.config');
  return [cli, p.join(config, 'kimi-desktop', 'daimon-share', 'daimon', 'runtime', 'kimi-code', 'home')];
}

function projectNameFromPath(path) {
  if (typeof path !== 'string' || !path) return null;
  return basename(path.replace(/[/\\]+$/, '')) || path;
}

/**
 * Map each session directory (absolute path) to a project name, read from
 * ~/.kimi-code/session_index.jsonl. Falls back gracefully if the file is
 * missing or malformed — callers default to the wd_ bucket name.
 */
function loadSessionIndex(root) {
  const map = new Map();
  const path = join(root, 'session_index.jsonl');

  let content;
  try {
    content = readFileSync(path, 'utf-8');
  } catch {
    return map;
  }

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const dir = entry?.sessionDir;
    const project = projectNameFromPath(entry?.workDir);
    if (typeof dir === 'string' && dir && project) map.set(dir, project);
  }
  return map;
}

// Strip the trailing _<hash> from a "wd_<slug>_<hash>" bucket name so the slug
// can serve as a last-resort project label when session_index has no entry.
function projectFromBucketName(name) {
  const m = /^wd_(.+)_[0-9a-f]+$/.exec(name);
  return m ? m[1] : name;
}

function usageTokens(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Collect every agents/<id>/wire.jsonl under sessions/wd_<...>/session_<...>/.
function findKimiCodeWireFiles(baseDir, warn) {
  const results = [];
  if (!existsSync(baseDir)) return results;

  let workDirs;
  try {
    workDirs = readdirSync(baseDir, { withFileTypes: true });
  } catch (error) {
    if (error.code !== 'ENOENT') warn('cannot list current session store');
    return results;
  }

  for (const workDir of workDirs) {
    if (!workDir.isDirectory()) continue;
    const workDirPath = join(baseDir, workDir.name);
    const bucketProject = projectFromBucketName(workDir.name);

    let sessions;
    try {
      sessions = readdirSync(workDirPath, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') warn('cannot list current sessions');
      continue;
    }

    for (const session of sessions) {
      if (!session.isDirectory()) continue;
      const sessionDir = join(workDirPath, session.name);
      const agentsDir = join(sessionDir, 'agents');

      let agents;
      try {
        agents = readdirSync(agentsDir, { withFileTypes: true });
      } catch (error) {
        if (error.code !== 'ENOENT') warn('cannot list session agents');
        continue;
      }

      for (const agent of agents) {
        if (!agent.isDirectory()) continue;
        const wireFile = join(agentsDir, agent.name, 'wire.jsonl');
        if (existsSync(wireFile)) {
          results.push({ wireFile, sessionDir, bucketProject });
        }
      }
    }
  }
  return results;
}

async function parseKimiCode(sessionSalt, warn, options) {
  const wires = new Map();
  const owners = new Map();
  const physical = new Set();
  const homes = currentKimiHomes(options);
  for (const root of homes) {
    const index = loadSessionIndex(root);
    for (const { wireFile, sessionDir, bucketProject } of findKimiCodeWireFiles(join(root, 'sessions'), warn)) {
      let path;
      try { path = realpathSync(wireFile); } catch { warn('cannot resolve session file'); continue; }
      if (physical.has(path)) continue;
      physical.add(path);
      const session = basename(sessionDir);
      if (!owners.has(session)) owners.set(session, {
        // The CLI session namespace is the historical HMAC input. Map the
        // desktop copy into that namespace even when there is no CLI file yet.
        sessionDir: join(homes[0], 'sessions', basename(dirname(sessionDir)), session),
        project: index.get(sessionDir) || bucketProject || 'unknown',
      });
      const agent = JSON.stringify([session, basename(dirname(wireFile))]);
      if (!wires.has(agent)) wires.set(agent, { ...owners.get(session), files: [] });
      wires.get(agent).files.push(wireFile);
    }
  }
  const entries = [];
  const sessionEvents = [];

  for (const { files, sessionDir, project } of wires.values()) {
    // Only compare records across physical copies of the same session/agent.
    // Two identical calls inside one wire are still two requests.
    const seen = files.length > 1 ? new Map() : null;
    for (const wireFile of files) {
      const occurrences = seen && new Map();
      const copied = fields => {
        if (!seen) return false;
        const key = JSON.stringify(fields);
        const count = (occurrences.get(key) || 0) + 1;
        occurrences.set(key, count);
        if ((seen.get(key) || 0) >= count) return true;
        seen.set(key, count);
        return false;
      };
      for await (const evt of jsonlRecords(wireFile, warn)) {
        const type = evt.type;
        // Top-level `time` is integer milliseconds since epoch. Validate it:
        // JSON numbers can overflow to Infinity (e.g. 1e400 parses fine), and
        // any out-of-range value yields an Invalid Date that later crashes
        // aggregateToBuckets() (RangeError from toISOString) — one corrupt line
        // would take down this tool's entire parse.
        const time = typeof evt.time === 'number' && Number.isFinite(evt.time) ? evt.time : null;
        const ts = time !== null ? new Date(time) : null;
        const tsValid = ts !== null && !isNaN(ts.getTime());

        // Session timing: a user turn vs. anything the model emits. All agent
        // wires under one sessionDir belong to the same logical user session;
        // grouping by wireFile would create separate zero-user sessions for
        // subagents instead of attributing their work to the parent turn.
        if (type === 'turn.prompt' && evt.origin?.kind === 'user') {
          if (tsValid && !copied([type, time, evt.turnId])) {
            sessionEvents.push({ sessionId: sessionDir, source: 'kimi-code', project, timestamp: ts, role: 'user' });
          }
          continue;
        }

        if (type !== 'usage.record') continue;
        // Every usage.record is a delta. `turn` is the normal successful-step
        // scope; `session` is used for other real model calls (for example
        // retry/compaction work), not for a cumulative summary. Count both.
        // No valid timestamp → can't bucket accurately. Skip instead of stamping
        // "now": this parser is stateless, so a "now" fallback would re-key the
        // same record into a fresh 30-min bucket on every sync (duplicates).
        if (!tsValid) continue;

        const usage = evt.usage;
        if (!usage) continue;

        const inputTokens = usageTokens(usage.inputOther);
        const cacheWriteInputTokens = usageTokens(usage.inputCacheCreation);
        const outputTokens = usageTokens(usage.output);
        const cacheReadInputTokens = usageTokens(usage.inputCacheRead);
        if (!inputTokens && !cacheWriteInputTokens && !outputTokens && !cacheReadInputTokens) continue;
        if (copied([type, time, evt.turnId, evt.usageScope, evt.model, inputTokens, cacheWriteInputTokens, outputTokens, cacheReadInputTokens])) continue;

        entries.push({
          source: 'kimi-code',
          model: evt.model || 'unknown',
          project,
          timestamp: ts,
          inputTokens,
          cacheWriteInputTokens,
          outputTokens,
          cacheReadInputTokens,
          reasoningOutputTokens: 0,
        });

        // Each usage.record marks an assistant step completing — use it as an
        // assistant timing event so active-time math has both sides of a turn.
        sessionEvents.push({ sessionId: sessionDir, source: 'kimi-code', project, timestamp: ts, role: 'assistant' });
      }
    }
  }

  return { buckets: aggregateToBuckets(entries), sessions: extractSessions(sessionEvents, sessionSalt) };
}

// ---------------------------------------------------------------------------
// Legacy format: ~/.kimi  (kept for users who haven't migrated to ~/.kimi-code)
// ---------------------------------------------------------------------------

// KBU_USAGE_KIMI_DIR overrides the legacy root (test hook).
const KIMI_DIR = process.env.KBU_USAGE_KIMI_DIR?.trim() || join(homedir(), '.kimi');
const KIMI_SESSIONS_DIR = join(KIMI_DIR, 'sessions');
const KIMI_WORKDIRS_JSON = join(KIMI_DIR, 'kimi.json');
const KIMI_CONFIG_TOML = join(KIMI_DIR, 'config.toml');

function findLegacyWireFiles(baseDir) {
  const results = [];
  if (!existsSync(baseDir)) return results;

  try {
    for (const workDir of readdirSync(baseDir, { withFileTypes: true })) {
      if (!workDir.isDirectory()) continue;
      const workDirPath = join(baseDir, workDir.name);

      try {
        for (const session of readdirSync(workDirPath, { withFileTypes: true })) {
          if (!session.isDirectory()) continue;
          const wireFile = join(workDirPath, session.name, 'wire.jsonl');
          if (existsSync(wireFile)) {
            results.push({ filePath: wireFile, workDirHash: workDir.name });
          }
        }
      } catch {
        continue;
      }
    }
  } catch {
    return results;
  }
  return results;
}

function loadLegacyProjectMap() {
  const map = new Map();
  if (!existsSync(KIMI_WORKDIRS_JSON)) return map;

  let config;
  try {
    config = JSON.parse(readFileSync(KIMI_WORKDIRS_JSON, 'utf-8'));
  } catch {
    return map;
  }

  if (Array.isArray(config.work_dirs)) {
    for (const entry of config.work_dirs) {
      const path = entry?.path;
      if (typeof path !== 'string' || !path) continue;
      const hash = createHash('md5').update(path).digest('hex');
      map.set(hash, projectNameFromPath(path));
    }
  }

  for (const key of ['workspaces', 'projects']) {
    const obj = config[key];
    if (!obj || typeof obj !== 'object') continue;
    for (const [hash, info] of Object.entries(obj)) {
      const path = typeof info === 'string' ? info : (info?.path || info?.dir);
      if (typeof path === 'string' && path) map.set(hash, projectNameFromPath(path));
    }
  }

  return map;
}

const TOML_MODEL_SECTION_RE = /^\s*\[models\.(?:"([^"]+)"|([A-Za-z0-9_-]+))\]/m;
const TOML_DEFAULT_MODEL_RE = /^\s*default_model\s*=\s*["']([^"']+)["']/m;

function loadLegacyModelFromConfig() {
  if (!existsSync(KIMI_CONFIG_TOML)) return 'unknown';

  let content;
  try {
    content = readFileSync(KIMI_CONFIG_TOML, 'utf-8');
  } catch {
    return 'unknown';
  }

  const defaultMatch = content.match(TOML_DEFAULT_MODEL_RE);
  if (defaultMatch) return defaultMatch[1];

  const sectionMatch = content.match(TOML_MODEL_SECTION_RE);
  if (sectionMatch) return sectionMatch[1] || sectionMatch[2];

  return 'unknown';
}

const LEGACY_USER_EVENT_TYPES = new Set(['TurnBegin', 'UserMessage', 'user_message', 'Input']);

async function parseLegacyKimi(sessionSalt, warn) {
  const wireFiles = findLegacyWireFiles(KIMI_SESSIONS_DIR);
  if (wireFiles.length === 0) return { buckets: [], sessions: [] };

  const projectMap = loadLegacyProjectMap();
  const defaultModel = loadLegacyModelFromConfig();
  const entries = [];
  const sessionEvents = [];
  const seenMessageIds = new Set();

  for (const { filePath, workDirHash } of wireFiles) {
    const project = projectMap.get(workDirHash) || workDirHash;
    let currentModel = defaultModel;
    let lastTimestamp = null;

    for await (const raw of jsonlRecords(filePath, warn)) {
      const envelope = raw.message || raw;
      const type = envelope.type || raw.type;
      const payload = envelope.payload || raw.payload;
      if (!payload) continue;

      if (typeof raw.timestamp === 'number') {
        lastTimestamp = raw.timestamp * 1000;
      } else if (typeof payload.timestamp === 'number') {
        lastTimestamp = payload.timestamp * 1000;
      }
      if (payload.model) currentModel = payload.model;

      if (lastTimestamp) {
        const evTs = new Date(lastTimestamp);
        if (!isNaN(evTs.getTime())) {
          sessionEvents.push({
            sessionId: filePath,
            source: 'kimi-code',
            project,
            timestamp: evTs,
            role: LEGACY_USER_EVENT_TYPES.has(type) ? 'user' : 'assistant',
          });
        }
      }

      if (type !== 'StatusUpdate') continue;

      const tokenUsage = payload.token_usage;
      if (!tokenUsage) continue;
      if (!tokenUsage.input_other && !tokenUsage.output
        && !tokenUsage.input_cache_read && !tokenUsage.input_cache_creation) continue;

      const messageId = payload.message_id;
      if (messageId) {
        if (seenMessageIds.has(messageId)) continue;
        seenMessageIds.add(messageId);
      }

      // No valid timestamp → skip instead of stamping "now": this parser is
      // stateless, so a "now" fallback would re-key the same record into a
      // fresh 30-min bucket on every sync (duplicates).
      if (!lastTimestamp) continue;
      const ts = new Date(lastTimestamp);
      if (isNaN(ts.getTime())) continue;

      entries.push({
        source: 'kimi-code',
        model: currentModel,
        project,
        timestamp: ts,
        inputTokens: tokenUsage.input_other || 0,
        cacheWriteInputTokens: tokenUsage.input_cache_creation || 0,
        outputTokens: tokenUsage.output || 0,
        cacheReadInputTokens: tokenUsage.input_cache_read || 0,
        reasoningOutputTokens: 0,
      });
    }
  }

  return { buckets: aggregateToBuckets(entries), sessions: extractSessions(sessionEvents, sessionSalt) };
}

// Roots this source would scan: the current and legacy stores that actually
// exist on disk. Used by the registry for skip detection and `inspect`.
export function roots(options) {
  const unique = new Map();
  for (const dir of [...currentKimiHomes(options), KIMI_DIR]) {
    if (!existsSync(dir)) continue;
    const key = realpathSync(dir);
    if (!unique.has(key)) unique.set(key, dir);
  }
  return [...unique.values()];
}

export async function parse({ sessionSalt, ...options } = {}) {
  // Always parse both stores and merge (see the header comment): legacy usage
  // is never carried into ~/.kimi-code by `kimi migrate`, so a migrated user's
  // history exists only in ~/.kimi.
  const warnings = [];
  const warn = (message) => { if (warnings.length < 20) warnings.push(`kimi-code: ${message}`); };
  const current = await parseKimiCode(sessionSalt, warn, options);
  const legacy = await parseLegacyKimi(sessionSalt, warn);
  return {
    buckets: [...(current?.buckets ?? []), ...legacy.buckets],
    sessions: [...(current?.sessions ?? []), ...legacy.sessions],
    ...(warnings.length ? { skipped: true, warnings } : {}),
  };
}
