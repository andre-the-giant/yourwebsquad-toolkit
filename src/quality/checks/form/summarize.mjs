function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeFormPayload(payload) {
  const stats = payload?.stats || {};
  const totalForms = toNumber(stats.totalForms);
  const testsRun = toNumber(stats.testsRun);
  const failed = toNumber(stats.failed);

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Form tests completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  return {
    summary: `Form tests: ${failed} failed assertions across ${totalForms} form(s), ${testsRun} assertion(s) run`,
    failed: Boolean(payload?.failed) || failed > 0,
  };
}
