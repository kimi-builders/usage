import { createHash } from 'node:crypto';

// Merge resumed segments only within one logical session. Per-segment order
// matters for counter resets and fork replay; sorting every record by its
// timestamp can move replayed records across those boundaries. Keep exact
// shared observations once, preserving repeated occurrences within a file.
export function mergeContinuations(segments, metadataFor) {
  if (segments.length === 1) return segments[0];
  const byStart = [...segments].sort((a, b) => a.start - b.start);
  const first = byStart[0];
  const nodes = new Map();
  for (const segment of byStart) {
    const metadata = metadataFor(segment.meta?.payload);
    const occurrences = new Map();
    let previous;
    let model, effort, tier;
    for (const record of segment.records) {
      const p = record.payload;
      const context = record.type === 'turn_context' ? p : p?.type === 'thread_settings_applied' ? p.thread_settings : null;
      if (context?.model) model = context.model;
      if (record.type === 'turn_context') effort = p?.effort || '';
      if (context && Object.hasOwn(context, 'service_tier')) tier = context.service_tier;
      const hash = createHash('sha256').update(JSON.stringify(record)).digest('base64url');
      const n = (occurrences.get(hash) || 0) + 1;
      occurrences.set(hash, n);
      const key = hash + ':' + n;
      let node = nodes.get(key);
      if (!node) {
        // Record-local data takes precedence; these values are only fallback
        // context if sibling segments interleave. No raw messages or tool data.
        const observation = record === first.meta ? record : { ...record, segmentMetadata: metadata };
        if (record.type === 'token_usage_record' || p?.type === 'token_count') {
          observation.segmentContext = { model, effort, tier, execution: segment.meta?.payload?.session_id || segment.sessionId };
        }
        node = { record: observation, at: new Date(record.timestamp).getTime(), next: new Set(), pending: 0, ordinal: nodes.size };
        nodes.set(key, node);
      }
      if (previous && !previous.next.has(node)) {
        previous.next.add(node);
        node.pending++;
      }
      previous = node;
    }
  }
  const ready = [...nodes.values()].filter(n => !n.pending);
  const records = [];
  while (ready.length) {
    ready.sort((a, b) => (a.at - b.at) || a.ordinal - b.ordinal);
    const node = ready.shift();
    records.push(node.record);
    for (const next of node.next) if (!--next.pending) ready.push(next);
  }
  if (records.length !== nodes.size) return null; // conflicting copies: do not claim a complete result.
  return { ...first, records, metaCount: byStart.reduce((sum, segment) => sum + segment.metaCount, 0) };
}
