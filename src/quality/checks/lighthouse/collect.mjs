import fs from "node:fs";
import path from "node:path";

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function asFiniteNumber(value) {
  return Number.isFinite(value) ? Number(value) : null;
}

function findResourceSummaryItem(report, resourceType) {
  const items = report?.audits?.["resource-summary"]?.details?.items;
  if (!Array.isArray(items)) return null;
  return items.find((item) => item?.resourceType === resourceType) || null;
}

function extractMetricsFromLighthouseReport(report) {
  const metrics = report?.audits?.metrics?.details?.items?.[0] || {};
  const totalSummary = findResourceSummaryItem(report, "total");
  const documentSummary = findResourceSummaryItem(report, "document");
  return {
    htmlSizeBytes: asFiniteNumber(documentSummary?.transferSize),
    totalLoadedSizeBytes:
      asFiniteNumber(report?.audits?.["total-byte-weight"]?.numericValue) ??
      asFiniteNumber(totalSummary?.transferSize),
    totalLoadTimeMs:
      asFiniteNumber(metrics.observedLoad) ??
      asFiniteNumber(report?.audits?.metrics?.numericValue),
  };
}

export function collectLighthouseFromReportDir(reportDir, options = {}) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  const collectedMetrics = [];
  const fallbackMetrics = readJsonIfExists(
    path.join(reportDir, "metrics.json"),
  );
  const summary = path.join(reportDir, "summary.html");
  const logPath = options.logPath || null;
  const htmlReports = [];
  const htmlByBaseName = new Map();
  if (fs.existsSync(reportDir)) {
    for (const name of fs.readdirSync(reportDir)) {
      if (!name.endsWith(".html")) continue;
      if (name === "summary.html" || name === "report.html") continue;
      const fullPath = path.join(reportDir, name);
      if (!fs.statSync(fullPath).isFile()) continue;
      htmlReports.push({
        name,
        path: fullPath,
      });
      const baseName = name.endsWith(".report.html")
        ? name.slice(0, -".report.html".length)
        : name.slice(0, -".html".length);
      if (!htmlByBaseName.has(baseName)) {
        htmlByBaseName.set(baseName, name);
      }
    }

    for (const name of fs.readdirSync(reportDir)) {
      if (!name.endsWith(".json")) continue;
      if (name === "stats.json" || name === "metrics.json") continue;
      const fullPath = path.join(reportDir, name);
      const report = readJsonIfExists(fullPath);
      if (!report?.categories) continue;
      const baseName = name.slice(0, -".json".length);
      const url =
        report.finalDisplayedUrl ||
        report.finalUrl ||
        report.requestedUrl ||
        report.mainDocumentUrl ||
        baseName;
      collectedMetrics.push({
        url,
        ...extractMetricsFromLighthouseReport(report),
        htmlReport: htmlByBaseName.get(baseName) || null,
      });
    }
  }
  return {
    reportDir,
    logPath,
    stats,
    metrics:
      collectedMetrics.length > 0
        ? collectedMetrics
        : Array.isArray(fallbackMetrics)
          ? fallbackMetrics
          : [],
    htmlReports,
    hasSummaryHtml: fs.existsSync(summary),
  };
}
