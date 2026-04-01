function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeVnuPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];
  const errorCount = toNumber(stats?.errorCount);
  const inferredFailed = errorCount > 0;
  const pageIssueMap = new Map();

  for (const issue of issues) {
    const url = String(issue?.url || "").trim() || "Unknown page";
    if (!pageIssueMap.has(url)) pageIssueMap.set(url, []);
    pageIssueMap.get(url).push(issue);
  }

  const pageSummaries = Array.from(pageIssueMap.entries()).map(
    ([url, pageIssues], index) => {
      const errors = pageIssues.filter(
        (issue) => String(issue?.severity || "").toLowerCase() === "error",
      ).length;
      const warnings = pageIssues.filter(
        (issue) => String(issue?.severity || "").toLowerCase() === "warning",
      ).length;
      return {
        name: `${String(index + 1).padStart(4, "0")}.html`,
        label: url,
        url,
        errors,
        warnings,
        status: errors > 0 ? "failed" : warnings > 0 ? "warn" : "passed",
        issues: pageIssues,
      };
    },
  );

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
      pageSummaries,
    },
  };
}
