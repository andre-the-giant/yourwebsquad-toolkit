function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeSeoPayload(payload) {
  const stats = payload?.stats || {};
  const errors = toNumber(stats.errorCount);
  const warnings = toNumber(stats.warningCount);
  const failed = Boolean(payload?.failed) || errors > 0;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "SEO audit completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const summary =
    errors || warnings
      ? `SEO issues: ${errors} errors${warnings ? `, ${warnings} warnings` : ""}`
      : "SEO issues: 0";
  return { summary, failed };
}

