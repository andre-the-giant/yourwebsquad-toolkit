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

export function collectVnuFromReportDir(reportDir, options = {}) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  const issues = readJsonIfExists(path.join(reportDir, "issues.json"));
  const reportHtml = path.join(reportDir, "report.html");
  const summaryMd = path.join(reportDir, "SUMMARY.md");

  return {
    reportDir,
    logPath: options.logPath || null,
    stats,
    issues: Array.isArray(issues) ? issues : [],
    reportHtmlPath: fs.existsSync(reportHtml) ? reportHtml : null,
    summaryMdPath: fs.existsSync(summaryMd) ? summaryMd : null,
    hasReportHtml: fs.existsSync(reportHtml),
    hasSummaryMd: fs.existsSync(summaryMd),
  };
}
