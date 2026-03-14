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
  const htmlReports = [];
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
    }
  }
  return {
    reportDir,
    logPath,
    stats,
    metrics,
    htmlReports,
    hasSummaryHtml: fs.existsSync(summary),
  };
}
