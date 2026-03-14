function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeLighthousePayload(raw, options = {}) {
  const stats = raw?.stats || null;
  const metrics = raw?.metrics || null;
  const assertionFailures = toNumber(stats?.assertionFailures);
  const runFailures = toNumber(stats?.runFailures);
  const inferredFailed = assertionFailures > 0 || runFailures > 0;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    stats,
    metrics,
    meta: {
      hasSummaryHtml: Boolean(raw?.hasSummaryHtml),
      logPath: raw?.logPath || null,
      htmlReports: Array.isArray(raw?.htmlReports) ? raw.htmlReports : [],
    },
  };
}
