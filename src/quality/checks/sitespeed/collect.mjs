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

export function collectSitespeedFromReportDir(reportDir, options = {}) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  const summaryMd = path.join(reportDir, "SUMMARY.md");
  const indexHtml = path.join(reportDir, "index.html");
  return {
    reportDir,
    logPath: options.logPath || null,
    stats,
    reportDirPath: fs.existsSync(reportDir) ? reportDir : null,
    indexHtmlPath: fs.existsSync(indexHtml) ? indexHtml : null,
    summaryMdPath: fs.existsSync(summaryMd) ? summaryMd : null,
    hasReportHtml: fs.existsSync(indexHtml),
    hasSummaryMd: fs.existsSync(summaryMd),
  };
}
