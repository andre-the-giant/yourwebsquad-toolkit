function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeSecurityPayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const findings = toNumber(stats?.findingsTotal);
  const statsFailed = Boolean(stats?.failed);
  const inferredFailed = statsFailed || findings > 0;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    stats,
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      hasSummaryMd: Boolean(raw?.hasSummaryMd),
    },
  };
}
