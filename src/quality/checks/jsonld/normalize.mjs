function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeJsonldPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];
  const errorCount = stats ? toNumber(stats.errorCount) : 0;
  const warningCount = stats ? toNumber(stats.warningCount) : 0;
  const inferredFailed = errorCount > 0;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    stats: stats || {
      pagesTested: 0,
      errorCount,
      warningCount,
      filesWithErrors: 0,
      filesWithWarnings: 0,
    },
    issues,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      reportHtmlPath: raw?.reportHtmlPath || null,
      reportTextPath: raw?.reportTextPath || null,
      pageReports: Array.isArray(raw?.pageReports) ? raw.pageReports : [],
      pageSummaries: Array.isArray(raw?.pageSummaries) ? raw.pageSummaries : [],
    },
  };
}
