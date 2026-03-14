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

export function collectSeoFromReportDir(reportDir, options = {}) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  const issues = readJsonIfExists(path.join(reportDir, "issues.json"));
  const reportHtml = path.join(reportDir, "report.html");
  const summaryMd = path.join(reportDir, "SUMMARY.md");
  const pageReportsDir = path.join(reportDir, "pages");
  const pageReports = [];
  if (fs.existsSync(pageReportsDir)) {
    for (const name of fs.readdirSync(pageReportsDir)) {
      if (!name.endsWith(".html")) continue;
      const fullPath = path.join(pageReportsDir, name);
      if (!fs.statSync(fullPath).isFile()) continue;
      pageReports.push({
        name,
        path: fullPath,
      });
    }
    pageReports.sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    reportDir,
    logPath: options.logPath || null,
    stats,
    issues: Array.isArray(issues) ? issues : [],
    reportHtmlPath: fs.existsSync(reportHtml) ? reportHtml : null,
    summaryMdPath: fs.existsSync(summaryMd) ? summaryMd : null,
    pageReports,
    hasReportHtml: fs.existsSync(reportHtml),
  };
}
