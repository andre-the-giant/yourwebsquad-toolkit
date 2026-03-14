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

export function collectLighthouseFromReportDir(reportDir, options = {}) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  const metrics = readJsonIfExists(path.join(reportDir, "metrics.json"));
  const summary = path.join(reportDir, "summary.html");
  const logPath = options.logPath || null;
  return {
    reportDir,
    logPath,
    stats,
    metrics,
    hasSummaryHtml: fs.existsSync(summary),
  };
}
