function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function brokenCount(links) {
  if (!links) return 0;
  if (Array.isArray(links.broken)) return links.broken.length;
  if (Array.isArray(links.brokenLinks)) return links.brokenLinks.length;
  return toNumber(links.broken);
}

export function normalizeLinksPayload(raw, options = {}) {
  const links = raw?.links || null;
  const tools =
    links?.tools && typeof links.tools === "object" ? links.tools : {};
  const broken = brokenCount(links);
  const linkinatorBroken = toNumber(tools?.linkinator?.brokenCount);
  const combinedBroken =
    toNumber(links?.brokenCombinedCount) || broken + linkinatorBroken;
  const skippedExternal = toNumber(links?.skippedExternal);
  const inferredFailed = combinedBroken > 0;

  return {
    selected: options.selected !== false,
    failed: Boolean(options.failed) || inferredFailed,
    links,
    stats: {
      broken,
      linkinatorBroken,
      brokenCombined: combinedBroken,
      skippedExternal,
      tools,
    },
    meta: {
      logPath: raw?.logPath || null,
      hasReportHtml: Boolean(raw?.hasReportHtml),
      reportHtmlPath: raw?.reportHtmlPath || null,
      summaryMdPath: raw?.summaryMdPath || null,
      pageReports: Array.isArray(raw?.pageReports) ? raw.pageReports : [],
      pageSummaries: Array.isArray(raw?.pageSummaries) ? raw.pageSummaries : [],
    },
  };
}
