function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizePa11yPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const errors = toNumber(stats?.errorCount);
  const warnings = toNumber(stats?.warningCount);
  const inferredFailed = errors > 0;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    stats,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      hasSummaryMd: Boolean(raw?.hasSummaryMd),
      warningCount: warnings,
      reportHtmlPath: raw?.reportHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
      pageReports: Array.isArray(raw?.pageReports) ? raw.pageReports : [],
    },
  };
}
