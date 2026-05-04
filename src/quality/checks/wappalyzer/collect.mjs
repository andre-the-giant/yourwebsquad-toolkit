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

export function collectWappalyzerFromReportDir(reportDir, options = {}) {
  const stats = readJsonIfExists(path.join(reportDir, "stats.json"));
  const technologies = readJsonIfExists(
    path.join(reportDir, "technologies.json"),
  );
  const pages = readJsonIfExists(path.join(reportDir, "pages.json"));
  const errors = readJsonIfExists(path.join(reportDir, "errors.json"));
  const reportHtml = path.join(reportDir, "report.html");

  return {
    reportDir,
    logPath: options.logPath || null,
    stats,
    technologies: Array.isArray(technologies) ? technologies : [],
    pages: Array.isArray(pages) ? pages : [],
    errors: Array.isArray(errors) ? errors : [],
    reportHtmlPath: fs.existsSync(reportHtml) ? reportHtml : null,
    hasReportHtml: fs.existsSync(reportHtml),
  };
}
