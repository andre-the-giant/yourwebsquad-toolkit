function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function categoryNamesFor(technology) {
  return Array.isArray(technology?.categories)
    ? technology.categories
        .map((category) => category?.name || category?.slug || null)
        .filter(Boolean)
    : [];
}

export function normalizeWappalyzerPayload(raw, options = {}) {
  const technologies = Array.isArray(raw?.technologies) ? raw.technologies : [];
  const pages = Array.isArray(raw?.pages) ? raw.pages : [];
  const errors = Array.isArray(raw?.errors) ? raw.errors : [];
  const categoryNames = new Set();
  for (const technology of technologies) {
    for (const name of categoryNamesFor(technology)) {
      categoryNames.add(name);
    }
  }

  const stats = raw?.stats && typeof raw.stats === "object" ? raw.stats : {};
  const pagesTested = toNumber(stats.pagesTested || pages.length);
  const pagesFailed = toNumber(stats.pagesFailed || errors.length);
  const technologiesDetected = toNumber(
    stats.technologiesDetected || technologies.length,
  );
  const failed =
    Boolean(options.failed) || (pagesTested > 0 && pagesFailed >= pagesTested);

  return {
    selected: options.selected !== false,
    failed,
    stats: {
      pagesTested,
      pagesFailed,
      technologiesDetected,
      categoriesDetected: toNumber(
        stats.categoriesDetected || categoryNames.size,
      ),
      detectionsTotal: toNumber(
        stats.detectionsTotal ||
          pages.reduce(
            (sum, page) =>
              sum +
              (Array.isArray(page?.technologies)
                ? page.technologies.length
                : 0),
            0,
          ),
      ),
    },
    technologies,
    issues: errors.map((error) => ({
      severity: "error",
      code: "wappalyzer-page-failed",
      message: error?.message || "Wappalyzer analysis failed for page.",
      pageUrl: error?.url || null,
    })),
    meta: {
      logPath: raw?.logPath || null,
      reportHtmlPath: raw?.reportHtmlPath || null,
      pages,
      errors,
    },
  };
}
