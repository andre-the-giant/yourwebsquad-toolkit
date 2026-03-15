function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeSitespeedPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const runFailures = toNumber(stats?.runFailures);
  const inferredFailed = runFailures > 0;
  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    stats: stats || {
      urlsTested: 0,
      runFailures: 0,
      reportsGenerated: 0,
    },
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      hasSummaryMd: Boolean(raw?.hasSummaryMd),
      reportDirPath: raw?.reportDirPath || null,
      indexHtmlPath: raw?.indexHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
    },
  };
}
