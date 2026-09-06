const ISSUE_STATUSES = new Set(['failed', 'partial']);

export function sourceHasIssue(source = {}) {
  return ISSUE_STATUSES.has(source.status) || Number(source.warningCount || 0) > 0;
}

export function summarizeSourceHealth(sources = []) {
  return {
    healthyCount: sources.filter(
      (source) => source.status === 'ok' && Number(source.warningCount || 0) === 0,
    ).length,
    skippedCount: sources.filter((source) => source.status === 'skipped').length,
    issueSources: sources.filter(sourceHasIssue),
  };
}
