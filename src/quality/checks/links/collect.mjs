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

export function collectLinksFromReportDir(reportDir, options = {}) {
  const links = readJsonIfExists(path.join(reportDir, "links.json"));
  const reportHtml = path.join(reportDir, "report.html");
  return {
    reportDir,
    logPath: options.logPath || null,
    links,
    hasReportHtml: fs.existsSync(reportHtml),
  };
}

