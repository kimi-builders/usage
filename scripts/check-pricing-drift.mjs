import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DATASET_URL = 'https://www.aipricing.guru/api/pricing.json';
const MAX_DATASET_BYTES = 2 * 1024 * 1024;
const MAX_DATASET_AGE_MS = 72 * 60 * 60 * 1000;

export const CURATED_MODELS = Object.freeze([
  {
    id: 'gpt-6-astra',
    provider: 'openai',
    officialSource: 'https://developers.openai.com/api/docs/models/gpt-6-astra',
  },
  {
    id: 'gpt-5.6-sol',
    provider: 'openai',
    officialSource: 'https://developers.openai.com/api/docs/models/gpt-5.6-sol',
  },
  {
    id: 'claude-fable-5-1',
    provider: 'anthropic',
    officialSource: 'https://platform.claude.com/docs/en/models/fable-5-1/overview',
  },
  {
    id: 'gemini-3.8-flash',
    provider: 'google',
    officialSource: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    id: 'grok-4.5',
    provider: 'xai',
    officialSource: 'https://docs.x.ai/developers/pricing',
  },
]);

function rate(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function activeEntries(catalog, id, at) {
  return catalog.entries.filter((entry) => (
    entry.pattern === id
    && entry.source === null
    && entry.processingTier === 'standard'
    && Date.parse(entry.effectiveFrom) <= at
    && (!entry.effectiveTo || at < Date.parse(entry.effectiveTo))
  ));
}

function compareRates(issues, id, tier, entry, pricing) {
  if (!entry) {
    issues.push(`${id}/${tier}: catalog entry missing`);
    return;
  }
  const fields = [
    ['input', pricing.inputPerM],
    ['cacheRead', pricing.cachedInputPerM],
    ['cacheWrite', pricing.cacheWritePerM],
    ['output', pricing.outputPerM],
  ];
  for (const [catalogField, observed] of fields) {
    if (!Number.isFinite(observed)) continue;
    const actual = rate(entry[catalogField]);
    if (actual !== observed) {
      issues.push(`${id}/${tier}/${catalogField}: catalog=${actual ?? 'missing'} monitor=${observed}`);
    }
  }
}

export function comparePricingDataset(dataset, catalog, { now = Date.now() } = {}) {
  const issues = [];
  const updatedAt = Date.parse(dataset?.lastUpdated);
  if (!Number.isFinite(updatedAt)) return ['monitor: lastUpdated is missing or invalid'];
  if (updatedAt > now + (5 * 60 * 1000)) issues.push('monitor: lastUpdated is in the future');
  if (now - updatedAt > MAX_DATASET_AGE_MS) issues.push('monitor: dataset is older than 72 hours');
  if (!Array.isArray(dataset.models)) return [...issues, 'monitor: models is not an array'];

  for (const target of CURATED_MODELS) {
    const matches = dataset.models.filter((model) => model?.id === target.id);
    if (matches.length !== 1) {
      issues.push(`${target.id}: expected one monitor record, found ${matches.length}`);
      continue;
    }
    const monitored = matches[0];
    if (monitored.provider !== target.provider) {
      issues.push(`${target.id}: provider=${monitored.provider || 'missing'}, expected=${target.provider}`);
      continue;
    }
    if (!monitored.pricing || typeof monitored.pricing !== 'object') {
      issues.push(`${target.id}: pricing is missing`);
      continue;
    }

    const entries = activeEntries(catalog, target.id, now);
    const base = entries.find((entry) => entry.contextTier === 'short')
      || entries.find((entry) => entry.contextTier === '');
    compareRates(issues, target.id, 'base', base, monitored.pricing);
    if (base?.sourceUrl !== target.officialSource) {
      issues.push(`${target.id}: catalog provenance is not the approved official source`);
    }

    if (monitored.pricing.longContext) {
      const long = entries.find((entry) => entry.contextTier === 'long');
      compareRates(issues, target.id, 'long', long, monitored.pricing.longContext);
      if (long?.sourceUrl !== target.officialSource) {
        issues.push(`${target.id}/long: catalog provenance is not the approved official source`);
      }
    }
  }
  return issues;
}

async function responseText(response) {
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_DATASET_BYTES) throw new Error('monitor dataset exceeds 2 MiB');
  const text = await response.text();
  if (Buffer.byteLength(text) > MAX_DATASET_BYTES) throw new Error('monitor dataset exceeds 2 MiB');
  return text;
}

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response;
  try {
    response = await fetch(DATASET_URL, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`pricing monitor returned HTTP ${response.status}`);
  const dataset = JSON.parse(await responseText(response));
  const catalog = JSON.parse(readFileSync(
    new URL('../src/pricing/catalog-v1.json', import.meta.url),
    'utf8',
  ));
  const issues = comparePricingDataset(dataset, catalog);
  if (issues.length) {
    console.error('AI Pricing Guru detected possible catalog drift. Verify every change on the official provider page:');
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Pricing drift check passed for ${CURATED_MODELS.length} provider-verified models.`);
  console.log('AI Pricing Guru is used only as a monitor; official provider pages remain authoritative.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Pricing drift check failed: ${error?.message || error}`);
    process.exitCode = 1;
  });
}
