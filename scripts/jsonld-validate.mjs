#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import Validator from "@adobe/structured-data-validator";
import WebAutoExtractor from "@marbec/web-auto-extractor";

const argv = process.argv.slice(2);
const targetDir = path.resolve(
  process.cwd(),
  firstPositionalArg(argv) || "build",
);
const urlsFile = resolveUrlsFileArg(argv);
const schemaUrl =
  process.env.SCHEMA_ORG_URL ||
  "https://schema.org/version/latest/schemaorg-all-https.jsonld";
const schemaCachePath = path.join(
  process.cwd(),
  ".yws-cache",
  "schemaorg-all-https.jsonld",
);
const schemaFile = resolveSchemaFileArg(argv);
const reportDir = resolveReportDirArg(argv);

function firstPositionalArg(args) {
  return args.find((arg) => !arg.startsWith("--"));
}

function resolveUrlsFileArg(args) {
  const equals = args.find((arg) => arg.startsWith("--urls-file="));
  if (equals) return equals.split("=")[1];
  const flagIndex = args.indexOf("--urls-file");
  if (flagIndex > -1 && args[flagIndex + 1]) return args[flagIndex + 1];
  return path.join(process.cwd(), "reports", "urls.json");
}

function resolveSchemaFileArg(args) {
  const equals = args.find((arg) => arg.startsWith("--schema-file="));
  if (equals) return equals.split("=")[1];
  const flagIndex = args.indexOf("--schema-file");
  if (flagIndex > -1 && args[flagIndex + 1]) return args[flagIndex + 1];
  return null;
}

function resolveReportDirArg(args) {
  const equals = args.find((arg) => arg.startsWith("--report-dir="));
  if (equals) return path.resolve(process.cwd(), equals.split("=")[1]);
  const flagIndex = args.indexOf("--report-dir");
  if (flagIndex > -1 && args[flagIndex + 1]) {
    return path.resolve(process.cwd(), args[flagIndex + 1]);
  }
  return path.join(process.cwd(), "reports", "jsonld");
}

function normalizePath(p) {
  return p.replace(/\/+$/, "");
}

function filePathForUrl(urlString) {
  try {
    const url = new URL(urlString);
    const cleanPath = normalizePath(url.pathname || "/");
    const asDir = path.join(targetDir, cleanPath);
    const htmlInDir = path.join(asDir, "index.html");
    const directHtml = path.join(targetDir, `${cleanPath}.html`);
    if (fs.existsSync(htmlInDir)) return htmlInDir;
    if (fs.existsSync(directHtml)) return directHtml;
    return null;
  } catch {
    return null;
  }
}

function loadHtmlFilesFromUrls() {
  if (!urlsFile || !fs.existsSync(urlsFile)) return null;
  try {
    const urls = JSON.parse(fs.readFileSync(urlsFile, "utf8"));
    if (!Array.isArray(urls)) return null;
    const files = urls
      .map(filePathForUrl)
      .filter(Boolean)
      .filter((file, idx, arr) => arr.indexOf(file) === idx);
    return files;
  } catch {
    return null;
  }
}

function loadUrlByFileMap() {
  const map = new Map();
  if (!urlsFile || !fs.existsSync(urlsFile)) return map;
  try {
    const urls = JSON.parse(fs.readFileSync(urlsFile, "utf8"));
    if (!Array.isArray(urls)) return map;
    for (const url of urls) {
      const file = filePathForUrl(url);
      if (!file) continue;
      if (!map.has(file)) {
        map.set(file, url);
      }
    }
  } catch {
    return map;
  }
  return map;
}

function readHtmlFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return readHtmlFiles(full);
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) {
      return [full];
    }
    return [];
  });
}

function formatPath(pathValue) {
  if (!Array.isArray(pathValue) || pathValue.length === 0) return "";
  return pathValue
    .map((segment) => {
      if (typeof segment === "string") return segment;
      if (segment && typeof segment === "object") {
        const type = segment.type || segment.key || "node";
        const index =
          Number.isInteger(segment.index) && segment.index >= 0
            ? `[${segment.index}]`
            : "";
        return `${type}${index}`;
      }
      return String(segment);
    })
    .join(" > ");
}

function normalizeIssue(issue) {
  return {
    issueMessage: issue?.issueMessage || issue?.message || "Validation issue",
    severity: String(issue?.severity || "ERROR").toUpperCase(),
    path: issue?.path,
    fieldNames: Array.isArray(issue?.fieldNames) ? issue.fieldNames : [],
    location: issue?.location,
  };
}

function normalizeIssues(result) {
  if (Array.isArray(result)) return result.map(normalizeIssue);
  if (Array.isArray(result?.issues)) return result.issues.map(normalizeIssue);
  return [];
}

function inferPagePathFromFile(filePath) {
  const relative = path.relative(targetDir, filePath).replace(/\\/g, "/");
  if (!relative || relative === "index.html") return "/";
  if (relative.endsWith("/index.html")) {
    const clean = relative.slice(0, -"index.html".length).replace(/\/+$/, "");
    return `/${clean || ""}/`;
  }
  if (relative.endsWith(".html")) {
    const clean = relative.slice(0, -".html".length);
    return `/${clean}`;
  }
  return `/${relative}`;
}

function countBySeverity(issues, severity) {
  return issues.filter((issue) => issue.severity === severity).length;
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const REPORT_THEME_CSS = `
  :root {
    --bg: #081225;
    --bg-elev: #0f1d37;
    --bg-elev-2: #132544;
    --text: #e6edf9;
    --muted: #9bb0d1;
    --line: #24395f;
    --accent: #78a9ff;
    --ok: #2dc98d;
    --warn: #f4c363;
    --fail: #ff7f7f;
    --info: #7ec8ff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 0;
    font-family: "Avenir Next", "Segoe UI", Arial, sans-serif;
    background: radial-gradient(circle at 15% 0%, #11244a 0, var(--bg) 42%);
    color: var(--text);
  }
  .report-page { padding: 24px; max-width: 1200px; margin: 0 auto; }
  .report-header h1 { margin: 0 0 8px; font-size: 30px; line-height: 1.2; }
  .report-subtitle { margin: 0; color: var(--muted); font-size: 14px; }
  .report-nav { margin: 10px 0 16px; display: flex; gap: 8px; flex-wrap: wrap; }
  .report-nav a {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg-elev-2) 75%, transparent);
    color: var(--accent);
    text-decoration: none;
    font-weight: 700;
    font-size: 13px;
  }
  .report-nav a:hover {
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    background: color-mix(in srgb, var(--accent) 16%, var(--bg-elev-2));
  }
  .report-section {
    margin-top: 20px;
    background: var(--bg-elev);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 16px;
  }
  .report-table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  .report-table th, .report-table td {
    border: 1px solid var(--line);
    padding: 8px;
    text-align: left;
  }
  .report-table th { background: #172b4e; }
  .report-card {
    background: var(--bg-elev-2);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 14px;
  }
  .status-chip {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  .status-chip.pass { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 35%, var(--line)); }
  .status-chip.warn { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 35%, var(--line)); }
  .status-chip.fail { color: var(--fail); border-color: color-mix(in srgb, var(--fail) 35%, var(--line)); }
  .status-chip.info { color: var(--info); border-color: color-mix(in srgb, var(--info) 35%, var(--line)); }
  .report-link-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
    border-radius: 10px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-elev-2));
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
    font-size: 12px;
  }
  .report-link-btn:hover {
    background: color-mix(in srgb, var(--accent) 22%, var(--bg-elev-2));
  }
  pre {
    background: #11172d;
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 12px;
    overflow: auto;
  }
`;

function statusChipHtml(label, tone = "info") {
  const allowed = new Set(["pass", "warn", "fail", "info"]);
  const safeTone = allowed.has(tone) ? tone : "info";
  return `<span class="status-chip ${safeTone}">${escapeHtml(label)}</span>`;
}

const REPORT_NAV_MODEL = [
  { key: "site-home", label: "Home", href: "/" },
  { key: "home", label: "Quality Reports", path: "index.html" },
  { key: "lighthouse", label: "Lighthouse", path: "lighthouse/summary.html" },
  { key: "pa11y", label: "Accessibility (Pa11y)", path: "pa11y/report.html" },
  { key: "seo", label: "SEO", path: "seo/report.html" },
  { key: "links", label: "Link check", path: "links/report.html" },
  { key: "jsonld", label: "JSON-LD", path: "jsonld/report.html" },
  { key: "security", label: "Security", path: "security/report.html" },
];

function buildCrossNavLinks(currentReportPath, options = {}) {
  const currentFile = String(currentReportPath || "jsonld/report.html").replace(
    /\\/g,
    "/",
  );
  const currentDir = path.posix.dirname(currentFile);
  const excludeKeys = new Set(options.excludeKeys || []);
  const reportsRoot = path.resolve(reportDir, "..");
  return REPORT_NAV_MODEL.filter((item) => !excludeKeys.has(item.key))
    .map((item) => {
      if (item.href) {
        return {
          ...item,
          href: item.href,
        };
      }
      const target = String(item.path || "").replace(/\\/g, "/");
      if (!target) return null;
      const absTarget = path.join(reportsRoot, target);
      if (!fs.existsSync(absTarget)) {
        return null;
      }
      const rel = path.posix.relative(currentDir, target);
      return {
        ...item,
        href: rel || "./",
      };
    })
    .filter(Boolean);
}

function renderReportShellStart({ title, subtitle = "", navLinks = [] }) {
  const nav = navLinks.length
    ? `<div class="report-nav">${navLinks
        .map(
          (link) =>
            `<a href="${escapeHtml(link.href || "#")}">${escapeHtml(link.label || "Back")}</a>`,
        )
        .join("")}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>${REPORT_THEME_CSS}</style>
</head>
<body>
  <main class="report-page">
    <header class="report-header">
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="report-subtitle">${escapeHtml(subtitle)}</p>` : ""}
      ${nav}
    </header>`;
}

function renderReportShellEnd() {
  return `
  </main>
</body>
</html>`;
}

function safeJsonStringify(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '"[Unable to serialize extracted schema]"';
  }
}

function jsonldOnlyFromExtractedSchema(extractedSchema) {
  if (
    extractedSchema &&
    typeof extractedSchema === "object" &&
    "jsonld" in extractedSchema
  ) {
    return extractedSchema.jsonld;
  }
  return null;
}

function writeJsonldArtifacts(pageResults, issues) {
  const errorCount = countBySeverity(issues, "ERROR");
  const warningCount = countBySeverity(issues, "WARNING");
  const filesWithErrors = new Set(
    pageResults.filter((page) => page.errorCount > 0).map((page) => page.file),
  ).size;
  const filesWithWarnings = new Set(
    pageResults
      .filter((page) => page.warningCount > 0)
      .map((page) => page.file),
  ).size;

  fs.mkdirSync(reportDir, { recursive: true });
  const issuesPath = path.join(reportDir, "issues.json");
  const statsPath = path.join(reportDir, "stats.json");

  fs.writeFileSync(issuesPath, JSON.stringify(issues, null, 2), "utf8");
  fs.writeFileSync(
    statsPath,
    JSON.stringify(
      {
        pagesTested: pageResults.length,
        errorCount,
        warningCount,
        filesWithErrors,
        filesWithWarnings,
      },
      null,
      2,
    ),
    "utf8",
  );
}

function pageReportFileName(page, index) {
  const candidate =
    page.url ||
    page.pagePath ||
    path.basename(page.file, path.extname(page.file));
  const slug = slugify(candidate) || `page-${index + 1}`;
  return `${String(index + 1).padStart(3, "0")}-${slug}.html`;
}

function writeJsonldPageReports(pageResults) {
  const pagesDir = path.join(reportDir, "pages");
  fs.mkdirSync(pagesDir, { recursive: true });

  for (let i = 0; i < pageResults.length; i += 1) {
    const page = pageResults[i];
    const fileName = pageReportFileName(page, i);
    const pageRelativePath = `pages/${fileName}`;
    const outPath = path.join(pagesDir, fileName);
    const schemaText = safeJsonStringify(
      jsonldOnlyFromExtractedSchema(page.extractedSchema),
    );

    const issuesHtml = page.issues.length
      ? page.issues
          .map((issue) => {
            const severityTone = issue.severity === "WARNING" ? "warn" : "fail";
            const fields =
              Array.isArray(issue.fieldNames) && issue.fieldNames.length
                ? `<div class="meta">fields: ${escapeHtml(issue.fieldNames.join(", "))}</div>`
                : "";
            const issuePath = formatPath(issue.path);
            const pathRow = issuePath
              ? `<div class="meta">path: ${escapeHtml(issuePath)}</div>`
              : "";
            const locationRow = issue.location
              ? `<div class="meta">location: ${escapeHtml(
                  typeof issue.location === "string"
                    ? issue.location
                    : JSON.stringify(issue.location),
                )}</div>`
              : "";
            return `<li style="padding: 10px 0; border-top: 1px solid var(--line);">
              <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                ${statusChipHtml(issue.severity, severityTone)}
                <strong>${escapeHtml(issue.issueMessage)}</strong>
              </div>
              ${fields}
              ${pathRow}
              ${locationRow}
            </li>`;
          })
          .join("\n")
      : `<li style="padding: 10px 0;">${statusChipHtml("No issues", "pass")}</li>`;

    const errorTone = Number(page.errorCount) > 0 ? "fail" : "pass";
    const warningTone = Number(page.warningCount) > 0 ? "warn" : "pass";

    const html = `${renderReportShellStart({
      title: "JSON-LD page report",
      subtitle: page.url || page.pagePath || page.file,
      navLinks: buildCrossNavLinks(`jsonld/pages/${fileName}`),
    })}
  <section class="report-section report-card">
    <p style="margin: 0 0 8px;"><strong>File:</strong> ${escapeHtml(page.file)}</p>
    <div style="display:flex; gap:10px; flex-wrap:wrap;">
      ${statusChipHtml(`${page.errorCount} Errors`, errorTone)}
      ${statusChipHtml(`${page.warningCount} Warnings`, warningTone)}
    </div>
  </section>
  <section class="report-section">
    <h2 style="margin:0 0 10px;">Issues</h2>
    <ul style="list-style:none; margin:0; padding:0;">
      ${issuesHtml}
    </ul>
  </section>
  <section class="report-section">
    <h2 style="margin:0 0 10px;">Extracted schema</h2>
    <pre>${escapeHtml(schemaText)}</pre>
  </section>
${renderReportShellEnd()}`;

    fs.writeFileSync(outPath, html, "utf8");
    page.detailReportPath = pageRelativePath;
  }
}

function writeJsonldSummaryReport(pageResults) {
  fs.mkdirSync(reportDir, { recursive: true });
  const sortedPages = [...pageResults].sort((a, b) => {
    const left = a.url || a.pagePath || a.file;
    const right = b.url || b.pagePath || b.file;
    return left.localeCompare(right);
  });
  const totalErrors = sortedPages.reduce(
    (acc, page) => acc + Number(page.errorCount || 0),
    0,
  );
  const totalWarnings = sortedPages.reduce(
    (acc, page) => acc + Number(page.warningCount || 0),
    0,
  );

  const rows = sortedPages
    .map((page) => {
      const label = page.url || page.pagePath || page.file;
      const reportLink = page.detailReportPath
        ? `<a class="report-link-btn" href="./${escapeHtml(page.detailReportPath)}">report</a>`
        : "-";
      const errorTone = Number(page.errorCount) > 0 ? "fail" : "pass";
      const warningTone = Number(page.warningCount) > 0 ? "warn" : "pass";
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td>${statusChipHtml(String(page.errorCount), errorTone)}</td>
        <td>${statusChipHtml(String(page.warningCount), warningTone)}</td>
        <td>${reportLink}</td>
      </tr>`;
    })
    .join("\n");

  const errorTone = totalErrors > 0 ? "fail" : "pass";
  const warningTone = totalWarnings > 0 ? "warn" : "pass";

  const html = `${renderReportShellStart({
    title: "JSON-LD report",
    subtitle: `${sortedPages.length} pages tested`,
    navLinks: buildCrossNavLinks("jsonld/report.html"),
  })}
    <section class="report-section">
      <div style="display:flex; gap:10px; flex-wrap:wrap;">
        ${statusChipHtml(`${sortedPages.length} Pages`, "info")}
        ${statusChipHtml(`${totalErrors} Errors`, errorTone)}
        ${statusChipHtml(`${totalWarnings} Warnings`, warningTone)}
      </div>
    </section>
    <section class="report-section">
      <table class="report-table">
        <thead>
          <tr><th>URL</th><th>Errors</th><th>Warnings</th><th>Report</th></tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
${renderReportShellEnd()}`;

  const htmlPath = path.join(reportDir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");
}

function writeJsonldTextReport(pageResults, issues) {
  fs.mkdirSync(reportDir, { recursive: true });
  const errorCount = countBySeverity(issues, "ERROR");
  const warningCount = countBySeverity(issues, "WARNING");
  const pagesWithIssues = pageResults.filter(
    (page) => page.errorCount > 0 || page.warningCount > 0,
  ).length;

  const lines = [
    "JSON-LD report",
    "",
    `Pages tested: ${pageResults.length}`,
    `Pages with issues: ${pagesWithIssues}`,
    `Errors: ${errorCount}`,
    `Warnings: ${warningCount}`,
    "",
    "Artifacts:",
    "- report.html (summary table with per-page links)",
    "- pages/*.html (page-level details and extracted schema)",
    "- issues.json (all issues)",
    "- stats.json (aggregate counts)",
  ];

  const txtPath = path.join(reportDir, "report.txt");
  fs.writeFileSync(txtPath, `${lines.join("\n")}\n`, "utf8");

  // Clean up legacy artifact from older runs.
  const legacyHtmlPath = path.join(reportDir, "report-legacy.html");
  if (fs.existsSync(legacyHtmlPath)) {
    fs.rmSync(legacyHtmlPath, { force: true });
  }
}

async function fetchSchemaJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} while fetching schema`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function ensureParentDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value), "utf8");
}

async function loadSchemaOrgJson() {
  if (schemaFile) {
    if (!fs.existsSync(schemaFile)) {
      throw new Error(`Schema file not found: ${schemaFile}`);
    }
    return readJson(schemaFile);
  }

  try {
    const schema = await fetchSchemaJson(schemaUrl);
    writeJson(schemaCachePath, schema);
    return schema;
  } catch (error) {
    if (fs.existsSync(schemaCachePath)) {
      console.warn(
        `⚠️ Could not fetch schema.org JSON-LD (${error?.message || error}). Using cached schema: ${schemaCachePath}`,
      );
      return readJson(schemaCachePath);
    }
    throw error;
  }
}

async function main() {
  if (!fs.existsSync(targetDir)) {
    console.error(
      `❌ Target directory not found: ${targetDir}. Did you run "npm run build" first?`,
    );
    process.exit(1);
  }

  const htmlFiles = loadHtmlFilesFromUrls() || readHtmlFiles(targetDir);
  const urlByFile = loadUrlByFileMap();
  if (!htmlFiles.length) {
    console.warn(`⚠️ No HTML files found under ${targetDir}`);
    return;
  }

  const schemaOrgJson = await loadSchemaOrgJson();
  const validator = new Validator(schemaOrgJson);
  const extractor = new WebAutoExtractor({
    addLocation: true,
    embedSource: ["rdfa", "microdata"],
  });

  const pageResults = [];
  for (const file of htmlFiles) {
    if (
      file === path.join(targetDir, "index.html") ||
      file.startsWith(path.join(targetDir, "admin"))
    ) {
      continue;
    }

    const html = fs.readFileSync(file, "utf8");
    const pagePath = inferPagePathFromFile(file);
    let validationResult;
    let extractedSchema;
    let fileIssues = [];
    try {
      extractedSchema = extractor.parse(html);
      validationResult = await validator.validate(extractedSchema);
      fileIssues = normalizeIssues(validationResult).map((issue) => ({
        ...issue,
        file,
        pagePath,
      }));
    } catch (error) {
      fileIssues = [
        {
          file,
          pagePath,
          severity: "ERROR",
          issueMessage: `Validator crashed: ${error?.message || error}`,
          fieldNames: [],
          path: [],
          location: null,
        },
      ];
    }

    pageResults.push({
      url: urlByFile.get(file) || null,
      file,
      pagePath,
      extractedSchema: extractedSchema || null,
      issues: fileIssues,
      errorCount: countBySeverity(fileIssues, "ERROR"),
      warningCount: countBySeverity(fileIssues, "WARNING"),
    });
  }

  const issues = pageResults.flatMap((page) => page.issues);
  writeJsonldArtifacts(pageResults, issues);
  writeJsonldPageReports(pageResults);
  writeJsonldSummaryReport(pageResults);
  writeJsonldTextReport(pageResults, issues);
  if (issues.length > 0) {
    const errorIssues = issues.filter((i) => i.severity === "ERROR");
    const warningIssues = issues.filter((i) => i.severity === "WARNING");
    const filesWithErrors = new Set(errorIssues.map((i) => i.file)).size;
    const filesWithWarnings = new Set(warningIssues.map((i) => i.file)).size;

    console.error(
      `❌ JSON-LD validation found ${filesWithErrors} page(s) with errors` +
        (filesWithWarnings ? ` and ${filesWithWarnings} with warnings.` : "."),
    );

    issues.forEach((issue) => {
      console.error(`\n🔗 ${issue.file}`);
      const prefix = issue.severity === "WARNING" ? "⚠️" : "✖";
      console.error(`  ${prefix} ${issue.issueMessage}`);
      if (issue.fieldNames?.length) {
        console.error(`    fields: ${issue.fieldNames.join(", ")}`);
      }
      const pathLabel = formatPath(issue.path);
      if (pathLabel) {
        console.error(`    path: ${pathLabel}`);
      }
      if (issue.location) {
        console.error(`    location: ${issue.location}`);
      }
    });

    if (errorIssues.length) {
      process.exit(1);
    }
  } else {
    console.log(
      `✅ JSON-LD validation passed for ${htmlFiles.length} HTML file(s).`,
    );
  }
}

main().catch((err) => {
  console.error(`Unexpected error: ${err?.message || err}`);
  process.exit(1);
});
