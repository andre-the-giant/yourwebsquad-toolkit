function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeVnuPayload(payload) {
  const stats = payload?.stats || {};
  const errors = toNumber(stats.errorCount);
  const warnings = toNumber(stats.warningCount);
  const failed = Boolean(payload?.failed) || errors > 0;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Nu HTML Checker completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const summary =
    errors > 0 || warnings > 0
      ? `Nu HTML Checker: ${errors} errors, ${warnings} warnings`
      : "Nu HTML Checker: 0 errors, 0 warnings";
  return { summary, failed };
}
