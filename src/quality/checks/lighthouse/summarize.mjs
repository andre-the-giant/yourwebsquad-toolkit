function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeLighthousePayload(payload) {
  const stats = payload?.stats || {};
  const assertionFailures = toNumber(stats.assertionFailures);
  const runFailures = toNumber(stats.runFailures);
  const totalIssues = assertionFailures + runFailures;
  const logPath = payload?.meta?.logPath || null;

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: logPath
        ? `Lighthouse completed (log: ${logPath})`
        : "Lighthouse completed",
      failed: Boolean(payload?.failed),
    };
  }

  if (totalIssues > 0) {
    return {
      summary: `Lighthouse issues: ${totalIssues}${logPath ? ` (log: ${logPath})` : ""}`,
      failed: true,
    };
  }

  return { summary: "Lighthouse: 0 issues", failed: Boolean(payload?.failed) };
}

