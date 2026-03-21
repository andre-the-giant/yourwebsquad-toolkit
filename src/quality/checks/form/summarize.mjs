function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeFormPayload(payload) {
  const stats = payload?.stats || {};
  const totalForms = toNumber(stats.totalForms);
  const testsRun = toNumber(stats.testsRun);
  const failed = toNumber(stats.failed);
  const preflightFailed = toNumber(stats.preflightFailed);
  const skipped = Boolean(stats.skipped);
  const skippedReason = String(stats.skippedReason || "").trim();

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Form tests completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  return {
    summary: skipped
      ? `Form tests skipped: ${skippedReason || "no forms detected"}`
      : `Form tests: ${failed} failed assertions + ${preflightFailed} preflight failures across ${totalForms} form(s), ${testsRun} assertion(s) run`,
    failed: Boolean(payload?.failed) || failed + preflightFailed > 0,
  };
}
