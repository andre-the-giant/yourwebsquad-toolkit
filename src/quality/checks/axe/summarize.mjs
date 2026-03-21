function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeAxePayload(payload) {
  const stats = payload?.stats || {};
  const violations = toNumber(stats.violationCount);
  const incomplete = toNumber(stats.incompleteCount);
  const pagesTested = toNumber(stats.pagesTested);
  const failed = Boolean(payload?.failed) || violations > 0;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "aXe completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  return {
    summary: `aXe: ${violations} violations, ${incomplete} incomplete on ${pagesTested} page(s)`,
    failed,
  };
}
