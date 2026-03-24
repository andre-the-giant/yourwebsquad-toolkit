function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeAxePayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const results = Array.isArray(raw?.results) ? raw.results : [];
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];
  const violations =
    stats && typeof stats === "object"
      ? toNumber(stats.violationCount)
      : issues.reduce((sum, issue) => sum + toNumber(issue?.violationCount), 0);
  const pageSummaries = results.map((entry, index) => {
    const url = String(entry?.url || "").trim();
    const violationCount = toNumber(entry?.violationCount);
    const incompleteCount = toNumber(entry?.incompleteCount);
    const status = violationCount > 0 ? "failed" : "passed";
    const violations = Array.isArray(entry?.violations) ? entry.violations : [];
    return {
      name: `${String(index + 1).padStart(4, "0")}.html`,
      label: url || `Page ${index + 1}`,
      url,
      errors: violationCount,
      warnings: incompleteCount,
      violationCount,
      incompleteCount,
      status,
      violations,
    };
  });

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
      results,
      resultsCount: results.length,
      pageSummaries,
    },
  };
}
