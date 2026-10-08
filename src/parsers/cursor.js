import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregateToBuckets } from './index.js';

function csvPath(options = {}) {
  const value = options.cursor?.csvPath || process.env.KBU_USAGE_CURSOR_CSV?.trim();
  if (!value) return null;
  const path = resolve(value);
  return existsSync(path) ? path : null;
}

export function roots({ sourceOptions } = {}) {
  const path = csvPath(sourceOptions);
  return path ? [path] : [];
}

function rows(text) {
  const output = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field); output.push(row); field = ''; row = []; }
    else if (character !== '\r') field += character;
  }
  if (field || row.length > 0) { row.push(field); output.push(row); }
  return output;
}

function count(value) {
  const number = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function parseUsageCsvResult(text) {
  const parsedRows = rows(text);
  if (parsedRows.length < 2) return { entries: [] };
  const header = parsedRows[0].map((value) => value.trim());
  const column = (name) => header.indexOf(name);
  const dateIndex = column('Date');
  const modelIndex = column('Model');
  const hasTokenColumn = [
    'Input (w/o Cache Write)',
    'Input (w/ Cache Write)',
    'Cache Read',
    'Output Tokens',
  ].some((name) => column(name) >= 0);
  // A renamed column used to degrade silently: every row then parsed as zero
  // tokens, the run uploaded an empty snapshot, and sync.js pruned Cursor's
  // incremental state as if the account had gone quiet — the dashboard just
  // stopped counting Cursor. The export header is an external contract, so
  // treat one we do not recognise as a skipped run instead: the state
  // survives and the user gets a warning.
  if (dateIndex < 0 || modelIndex < 0 || !hasTokenColumn) {
    return {
      entries: [],
      skipped: true,
      warnings: [
        'cursor: export header does not match the expected columns ' +
        '(Date, Model and at least one token column); run skipped to protect incremental sync state. ' +
        'Cursor may have changed its export format.' +
        ` Current header: ${header.slice(0, 8).join(', ')}`,
      ],
    };
  }
  const entries = parsedRows.slice(1).flatMap((row) => {
    const rawDate = row[dateIndex]?.trim();
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? new Date(`${rawDate}T00:00:00.000Z`)
      : new Date(rawDate);
    const model = row[modelIndex]?.trim();
    if (!model || Number.isNaN(timestamp.getTime())) return [];
    const inputTokens = count(row[column('Input (w/o Cache Write)')]);
    const cacheWriteInputTokens = count(row[column('Input (w/ Cache Write)')]);
    const cacheReadInputTokens = count(row[column('Cache Read')]);
    const outputTokens = count(row[column('Output Tokens')]);
    if (inputTokens + cacheWriteInputTokens + cacheReadInputTokens + outputTokens === 0) return [];
    return [{
      source: 'cursor',
      model,
      project: 'unknown',
      timestamp,
      inputTokens,
      cacheWriteInputTokens,
      cacheReadInputTokens,
      outputTokens,
      reasoningOutputTokens: 0,
      requestCount: 1,
    }];
  });
  return { entries };
}

export function parseUsageCsv(text) {
  return parseUsageCsvResult(text).entries;
}

export async function parse({ sourceOptions } = {}) {
  const path = csvPath(sourceOptions);
  if (!path) return null;
  const { entries, ...report } = parseUsageCsvResult(readFileSync(path, 'utf8'));
  return {
    buckets: aggregateToBuckets(entries),
    sessions: [],
    ...report,
  };
}
