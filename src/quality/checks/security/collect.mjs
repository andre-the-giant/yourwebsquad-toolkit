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

export function collectSecurityFromReportDir(reportDir, options = {}) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  const reportHtml = path.join(reportDir, "report.html");
  const summaryMd = path.join(reportDir, "SUMMARY.md");
  const observatoryJson = path.join(reportDir, "observatory.json");
  return {
    reportDir,
    logPath: options.logPath || null,
    stats,
    reportHtmlPath: fs.existsSync(reportHtml) ? reportHtml : null,
    summaryMdPath: fs.existsSync(summaryMd) ? summaryMd : null,
    observatoryJsonPath: fs.existsSync(observatoryJson) ? observatoryJson : null,
    hasReportHtml: fs.existsSync(reportHtml),
    hasSummaryMd: fs.existsSync(summaryMd),
  };
}
