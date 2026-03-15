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

function parsePageReportSummary(filePath, fallbackName) {
  try {
    const html = fs.readFileSync(filePath, "utf8");
    const summaryMatch =
      html.match(/<p class="summary">([\s\S]*?)<\/p>/i) ||
      html.match(/<p class="report-subtitle">([\s\S]*?)<\/p>/i);
    const stripTags = (value) =>
      String(value || "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
    const label = stripTags(summaryMatch?.[1] || "") || fallbackName;
    const brokenMatch = html.match(/(\d+)\s+Broken\b/i);
    const errors = Number(brokenMatch?.[1] || 0);
    return {
      label,
      errors: Number.isFinite(errors) ? errors : 0,
    };
  } catch {
    return {
      label: fallbackName,
      errors: null,
    };
  }
}

export function collectLinksFromReportDir(reportDir, options = {}) {
  const links = readJsonIfExists(path.join(reportDir, "links.json"));
  const reportHtml = path.join(reportDir, "report.html");
  const summaryMd = path.join(reportDir, "SUMMARY.md");
  const pageReportsDir = path.join(reportDir, "pages");
  const pageReports = [];
  const pageSummaries = [];
  if (fs.existsSync(pageReportsDir)) {
    for (const name of fs.readdirSync(pageReportsDir)) {
      if (!name.endsWith(".html")) continue;
      const fullPath = path.join(pageReportsDir, name);
      if (!fs.statSync(fullPath).isFile()) continue;
      const summary = parsePageReportSummary(fullPath, name);
      pageReports.push({
        name,
        path: fullPath,
      });
      pageSummaries.push({
        name,
        label: summary.label,
        errors: summary.errors,
      });
    }
    pageReports.sort((a, b) => a.name.localeCompare(b.name));
    pageSummaries.sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    reportDir,
    logPath: options.logPath || null,
    links,
    reportHtmlPath: fs.existsSync(reportHtml) ? reportHtml : null,
    summaryMdPath: fs.existsSync(summaryMd) ? summaryMd : null,
    pageReports,
    pageSummaries,
    hasReportHtml: fs.existsSync(reportHtml),
  };
}
