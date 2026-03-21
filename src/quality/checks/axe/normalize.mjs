function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeAxePayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];
  const violations =
    stats && typeof stats === "object"
      ? toNumber(stats.violationCount)
      : issues.reduce((sum, issue) => sum + toNumber(issue?.violationCount), 0);

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || violations > 0,
    stats,
    issues,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      hasSummaryMd: Boolean(raw?.hasSummaryMd),
      reportHtmlPath: raw?.reportHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
      resultsCount: Array.isArray(raw?.results) ? raw.results.length : 0,
    },
  };
}
