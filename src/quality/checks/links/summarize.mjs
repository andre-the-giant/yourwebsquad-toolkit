function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeLinksPayload(payload) {
  const stats = payload?.stats || {};
  const broken = toNumber(stats.broken);
  const failed = Boolean(payload?.failed) || broken > 0;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Link check completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const summary = broken
    ? `Link check: ${broken} broken link(s)`
    : "Link check: 0 broken links";
  return { summary, failed };
}

