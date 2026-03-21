function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeFormPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const issues = Array.isArray(raw?.issues) ? raw.issues : [];

  const failedCount =
    stats && typeof stats === "object"
      ? toNumber(stats.failed)
      : issues.filter((issue) => issue?.status === "failed").length;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || failedCount > 0,
    stats,
    issues,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      hasSummaryMd: Boolean(raw?.hasSummaryMd),
      reportHtmlPath: raw?.reportHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
      testedForms:
        stats && typeof stats === "object" ? toNumber(stats.totalForms) : 0,
    },
  };
}
