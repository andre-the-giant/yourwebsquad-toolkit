function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeVnuPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];
  const errorCount = toNumber(stats?.errorCount);
  const inferredFailed = errorCount > 0;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    stats,
    issues,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      hasSummaryMd: Boolean(raw?.hasSummaryMd),
      reportHtmlPath: raw?.reportHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
    },
  };
}
