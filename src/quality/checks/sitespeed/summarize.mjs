function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeSitespeedPayload(payload) {
  const stats = payload?.stats || {};
  const failures = toNumber(stats.runFailures);
  const urls = toNumber(stats.urlsTested);
  const summary =
    failures > 0
      ? `Sitespeed.io failed on ${failures} run(s) (${urls} URL(s) tested)`
      : `Sitespeed.io completed (${urls} URL(s) tested)`;
  return {
    summary,
    failed: Boolean(payload?.failed) || failures > 0,
  };
}
