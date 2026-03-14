function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeSecurityPayload(payload) {
  const stats = payload?.stats || {};
  const findings = toNumber(stats.findingsTotal);
  const failed = Boolean(payload?.failed) || Boolean(stats.failed);

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Security audit completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const summary =
    findings > 0 ? `Security findings: ${findings}` : "Security findings: 0";
  return { summary, failed };
}
