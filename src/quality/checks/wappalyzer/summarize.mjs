function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function summarizeWappalyzerPayload(payload) {
  const stats = payload?.stats || {};
  const technologies = toNumber(stats.technologiesDetected);
  const categories = toNumber(stats.categoriesDetected);
  const pages = toNumber(stats.pagesTested);
  const pagesFailed = toNumber(stats.pagesFailed);

  if (!stats || Object.keys(stats).length === 0) {
    return {
      summary: "Wappalyzer stack detection completed (stats unavailable).",
      failed: Boolean(payload?.failed),
    };
  }

  const failureText = pagesFailed ? `, ${pagesFailed} page(s) failed` : "";
  return {
    summary: `Wappalyzer stack: ${technologies} technologies across ${categories} categories on ${pages} page(s)${failureText}`,
    failed: Boolean(payload?.failed),
  };
}
