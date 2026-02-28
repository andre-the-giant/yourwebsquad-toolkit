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
    page.url || page.pagePath || path.basename(page.file, path.extname(page.file));
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
            const severityClass =
              issue.severity === "WARNING" ? "warning" : "error";
            const fields = Array.isArray(issue.fieldNames) && issue.fieldNames.length
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
            return `<li class="${severityClass}">
              <div class="title">${escapeHtml(issue.severity)}: ${escapeHtml(issue.issueMessage)}</div>
              ${fields}
              ${pathRow}
              ${locationRow}
            </li>`;
          })
          .join("\n")
      : '<li class="ok"><div class="title">No issues for this page.</div></li>';

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>JSON-LD page report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0b1021; color: #e8ecf5; }
    h1 { margin: 0 0 6px; }
    .summary { margin: 0 0 14px; color: #9fb3ff; font-size: 14px; }
    .meta-block { background: #11172d; border: 1px solid #1f2a45; border-radius: 8px; padding: 14px; margin-bottom: 14px; }
    .meta-block p { margin: 4px 0; }
    .issues { list-style: none; padding: 0; margin: 0; }
    .issues li { border-top: 1px solid #1f2a45; padding: 10px 0; }
    .issues li:first-child { border-top: none; }
    .issues li.warning .title { color: #ffd27f; }
    .issues li.error .title { color: #ff8a8a; }
    .issues li.ok .title { color: #9ef5a1; }
    .meta { color: #b8c4ff; font-size: 12px; margin-top: 4px; }
    pre { background: #11172d; border: 1px solid #1f2a45; border-radius: 8px; padding: 12px; overflow: auto; }
    a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>JSON-LD page report</h1>
  <p class="summary">${escapeHtml(page.url || page.pagePath || page.file)}</p>
  <div class="meta-block">
    <p><strong>File:</strong> ${escapeHtml(page.file)}</p>
    <p><strong>Errors:</strong> ${page.errorCount} · <strong>Warnings:</strong> ${page.warningCount}</p>
    <p><a href="../report.html">Back to JSON-LD summary</a></p>
  </div>
  <h2>Issues</h2>
  <ul class="issues">
    ${issuesHtml}
  </ul>
  <h2>Extracted schema</h2>
  <pre>${escapeHtml(schemaText)}</pre>
</body>
</html>`;

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
        ? `<a href="./${escapeHtml(page.detailReportPath)}">report</a>`
        : "-";
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td>${page.errorCount}</td>
        <td>${page.warningCount}</td>
        <td>${reportLink}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>JSON-LD report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0b1021; color: #e8ecf5; }
    h1 { margin: 0 0 6px; }
    .summary { margin: 0 0 14px; color: #9fb3ff; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #1f2a45; padding: 8px; text-align: left; }
    th { background: #11172d; }
    a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>JSON-LD report</h1>
  <p class="summary">${sortedPages.length} pages · ${totalErrors} errors · ${totalWarnings} warnings</p>
  <table>
    <thead>
      <tr><th>URL</th><th>Errors</th><th>Warnings</th><th>Report</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

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
