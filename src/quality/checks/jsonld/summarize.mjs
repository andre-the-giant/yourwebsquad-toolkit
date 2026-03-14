function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeJsonldPayload(payload) {
  const stats = payload?.stats || {};
  const errors = toNumber(stats.errorCount);
  const warnings = toNumber(stats.warningCount);
  const pages = toNumber(stats.pagesTested);
  const failed = Boolean(payload?.failed) || errors > 0;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "JSON-LD validation completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const summary = `JSON-LD: ${errors} errors${warnings ? `, ${warnings} warnings` : ""} across ${pages} page(s)`;
  return { summary, failed };
}
