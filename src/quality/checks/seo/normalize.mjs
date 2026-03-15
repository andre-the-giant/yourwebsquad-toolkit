function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function countSeverity(issues, severity) {
  return issues.filter((issue) => issue?.severity === severity).length;
}

export function normalizeSeoPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];
  const errorCount = stats
    ? toNumber(stats.errorCount)
    : countSeverity(issues, "error");
  const warningCount = stats
    ? toNumber(stats.warningCount)
    : countSeverity(issues, "warn");
  const inferredFailed = errorCount > 0;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    stats: stats || {
      errorCount,
      warningCount,
      pagesTested: toNumber(raw?.stats?.pagesTested),
    },
    issues,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      reportHtmlPath: raw?.reportHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
      pageReports: Array.isArray(raw?.pageReports) ? raw.pageReports : [],
      pageSummaries: Array.isArray(raw?.pageSummaries) ? raw.pageSummaries : [],
    },
  };
}
