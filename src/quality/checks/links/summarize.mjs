function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeLinksPayload(payload) {
  const stats = payload?.stats || {};
  const internalBroken = toNumber(stats.broken);
  const linkinatorBroken = toNumber(stats.linkinatorBroken);
  const broken = toNumber(stats.brokenCombined) || internalBroken + linkinatorBroken;
  const failed = Boolean(payload?.failed) || broken > 0;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Link check completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const summary = broken
    ? `Link check: ${broken} broken link(s) (internal: ${internalBroken}, linkinator: ${linkinatorBroken})`
    : "Link check: 0 broken links";
  return { summary, failed };
}
