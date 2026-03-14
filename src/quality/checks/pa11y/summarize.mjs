function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizePa11yPayload(payload) {
  const stats = payload?.stats || {};
  const errors = toNumber(stats.errorCount);
  const warnings = toNumber(stats.warningCount);
  const failed = Boolean(payload?.failed) || errors > 0;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Pa11y completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const summary =
    errors || warnings
      ? `Pa11y issues: ${errors} errors${warnings ? `, ${warnings} warnings` : ""}`
      : "Pa11y issues: 0";
  return { summary, failed };
}
