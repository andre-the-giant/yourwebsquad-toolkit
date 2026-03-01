#!/usr/bin/env node

import pa11y from "pa11y";
import fs from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR =
  process.env.PA11Y_REPORT_DIR || path.join(process.cwd(), "reports/pa11y");

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.base ?? DEFAULT_BASE_URL;
const REPORT_DIR = args.reportDir ?? DEFAULT_REPORT_DIR;
const URLS_FILE = args.urlsFile;

const visited = new Set();
const toVisit = new Set([BASE_URL]);
const pageResults = [];
const REPORT_NAV_MODEL = [
  { key: "site-home", label: "Home", href: "/" },
  { key: "lighthouse", label: "Lighthouse", path: "lighthouse/summary.html" },
  { key: "pa11y", label: "Pa11y", path: "pa11y/report.html" },
  { key: "seo", label: "SEO", path: "seo/report.html" },
  { key: "links", label: "Link check", path: "links/report.html" },
  { key: "jsonld", label: "JSON-LD", path: "jsonld/report.html" },
  { key: "security", label: "Security", path: "security/report.html" },
];

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--base" || arg === "-b") && argv[i + 1]) {
      opts.base = argv[++i];
    } else if ((arg === "--report-dir" || arg === "-o") && argv[i + 1]) {
      opts.reportDir = argv[++i];
    } else if ((arg === "--urls-file" || arg === "-u") && argv[i + 1]) {
      opts.urlsFile = argv[++i];
    }
  }
  return opts;
}

function isInternal(url) {
  return normalizeUrl(url).startsWith(normalizeUrl(BASE_URL));
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString();
  } catch {
    return url;
  }
}

async function crawl(startUrl) {
  while (toVisit.size > 0) {
    const [url] = toVisit;
    toVisit.delete(url);
    visited.add(url);

    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      console.error(`❌ Failed to fetch ${url}: ${err.message}`);
      continue;
    }

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) continue;

    const html = await res.text();
    const root = parse(html);

    for (const anchor of root.querySelectorAll("a[href]")) {
      const href = anchor.getAttribute("href");
      if (!href) continue;
      if (
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("#")
      )
        continue;

      let absolute;
      try {
        absolute = href.startsWith("http")
          ? href
          : new URL(href, url).toString();
      } catch {
        continue;
      }

      if (!isInternal(absolute)) continue;
      const normalized = normalizeUrl(absolute);
      if (!visited.has(normalized) && !toVisit.has(normalized)) {
        toVisit.add(normalized);
      }
    }
  }

  return Array.from(visited).sort();
}

function loadUrlsFromFile(file, baseUrl) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((u) => {
          try {
            const url = new URL(u, baseUrl).toString();
            return normalizeUrl(url);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    }
  } catch {
    // ignore
  }
  return [];
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function pageReportFileName(pageUrl, index) {
  let source = pageUrl;
  try {
    const u = new URL(pageUrl);
    source = `${u.pathname}${u.search}` || u.hostname || pageUrl;
  } catch {
    // keep source as provided
  }
  const slug = slugify(source) || `page-${index + 1}`;
  return `${String(index + 1).padStart(3, "0")}-${slug}.html`;
}

function buildCrossNavLinks(currentReportPath, options = {}) {
  const currentFile = String(currentReportPath || "pa11y/report.html").replace(
    /\\/g,
    "/",
  );
  const currentDir = path.posix.dirname(currentFile);
  const excludeKeys = new Set(options.excludeKeys || []);

  return REPORT_NAV_MODEL.filter((item) => !excludeKeys.has(item.key))
    .map((item) => {
      if (item.href) return { ...item, href: item.href };
      const target = String(item.path || "").replace(/\\/g, "/");
      if (!target) return null;
      const rel = path.posix.relative(currentDir, target);
      return { ...item, href: rel || "./" };
    })
    .filter(Boolean);
}

function renderCrossNav(currentReportPath, options = {}) {
  const links = buildCrossNavLinks(currentReportPath, options)
    .map(
      (link) =>
        `<a href="${escapeHtml(link.href || "#")}">${escapeHtml(link.label)}</a>`,
    )
    .join("");
  return links ? `<div class="report-nav">${links}</div>` : "";
}

function writeMarkdownSummary(pages, reportDir) {
  const lines = ["# Pa11y accessibility report", ""];
  for (const page of pages) {
    lines.push(`## ${page.url}`);
    if (!page.issues.length) {
      lines.push("- ✅ No issues found", "");
      continue;
    }
    for (const issue of page.issues) {
      lines.push(
        `- ${issue.type === "error" ? "❌" : "⚠️"} **${issue.code}** at \`${issue.selector}\``,
        `  - Message: ${issue.message}`,
        issue.context
          ? `  - Context: \`${String(issue.context).slice(0, 120)}\``
          : "",
        "",
      );
    }
  }

  const summaryPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writePa11yPageReports(pages, reportDir) {
  const pagesDir = path.join(reportDir, "pages");
  fs.rmSync(pagesDir, { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });
  const reportPathByUrl = new Map();

  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    const fileName = pageReportFileName(page.url, index);
    const counts = page.issues.reduce(
      (acc, issue) => {
        if (issue.type === "error") acc.errors += 1;
        if (issue.type === "warning") acc.warnings += 1;
        return acc;
      },
      { errors: 0, warnings: 0 },
    );

    const issueRows = page.issues.length
      ? page.issues
          .map(
            (issue) => `<tr>
              <td>${escapeHtml(issue.code || "")}</td>
              <td>${escapeHtml(issue.type || "")}</td>
              <td>${escapeHtml(issue.message || "")}</td>
              <td><code>${escapeHtml(issue.selector || "")}</code></td>
              <td>${issue.context ? `<pre class="context-block">${escapeHtml(String(issue.context).slice(0, 600))}</pre>` : ""}</td>
            </tr>`,
          )
          .join("\n")
      : '<tr><td colspan="5">No issues 🎉</td></tr>';

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pa11y page report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0b1021; color: #e8ecf5; }
    h1 { margin-bottom: 0; }
    .summary { margin: 0 0 20px; color: #9fb3ff; }
    .report-nav { margin: 10px 0 16px; display: flex; gap: 8px; flex-wrap: wrap; }
    .report-nav a {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid #1f2a45;
      background: color-mix(in srgb, #11172d 75%, transparent);
      color: #9fb3ff;
      text-decoration: none;
      font-weight: 700;
      font-size: 13px;
    }
    .report-nav a:hover {
      border-color: color-mix(in srgb, #9fb3ff 40%, #1f2a45);
      background: color-mix(in srgb, #9fb3ff 16%, #11172d);
    }
    .report-section { margin-bottom: 18px; background: #11172d; border: 1px solid #1f2a45; border-radius: 10px; padding: 14px; }
    .snapshot-chips { display: flex; gap: 10px; flex-wrap: wrap; }
    .status-chip {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid #1f2a45;
      font-size: 12px;
      font-weight: 700;
    }
    .status-chip.info { color: #8fd5ff; }
    .status-chip.pass { color: #9ef5a1; }
    .status-chip.warn { color: #ffd27f; }
    .status-chip.fail { color: #ff8a8a; }
    .report-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .report-table th, .report-table td { border: 1px solid #1f2a45; padding: 8px; text-align: left; vertical-align: top; }
    .report-table th { background: #172b4e; }
    code { color: #b8c4ff; }
    .context-block {
      margin: 0;
      padding: 6px 8px;
      background: #0b1021;
      border: 1px solid #1f2a45;
      border-radius: 6px;
      max-width: 460px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #b8c4ff;
      font-size: 12px;
      line-height: 1.4;
    }
  </style>
</head>
<body>
  <h1>Pa11y page report</h1>
  <p class="summary">${escapeHtml(page.url)}</p>
  ${renderCrossNav(`pa11y/pages/${fileName}`)}
  <section class="report-section">
    <div class="snapshot-chips">
      <span class="status-chip info">1 Page</span>
      <span class="status-chip ${counts.errors > 0 ? "fail" : "pass"}">${counts.errors} Errors</span>
      <span class="status-chip ${counts.warnings > 0 ? "warn" : "pass"}">${counts.warnings} Warnings</span>
    </div>
  </section>
  <section class="report-section">
    <table class="report-table">
      <thead>
        <tr><th>Code</th><th>Severity</th><th>Message</th><th>Selector</th><th>Context</th></tr>
      </thead>
      <tbody>
        ${issueRows}
      </tbody>
    </table>
  </section>
</body>
</html>`;

    fs.writeFileSync(path.join(pagesDir, fileName), html, "utf8");
    reportPathByUrl.set(page.url, `./pages/${fileName}`);
  }

  return { count: pages.length, reportPathByUrl };
}

function writeHtmlReport(
  pages,
  totals,
  reportDir,
  reportPathByUrl = new Map(),
) {
  const pagesWithIssues = pages.filter((page) => page.issues.length > 0).length;

  const tableRows = pages
    .map((page) => {
      const counts = page.issues.reduce(
        (acc, issue) => {
          if (issue.type === "error") acc.errors += 1;
          if (issue.type === "warning") acc.warnings += 1;
          return acc;
        },
        { errors: 0, warnings: 0 },
      );
      const reportHref = reportPathByUrl.get(page.url);
      const reportLink = reportHref
        ? `<a class="report-link-btn" href="${escapeHtml(reportHref)}">report</a>`
        : "-";
      return `<tr>
        <td>${escapeHtml(page.url)}</td>
        <td>${counts.errors}</td>
        <td>${counts.warnings}</td>
        <td>${reportLink}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Pa11y accessibility report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0b1021; color: #e8ecf5; }
    h1 { margin-bottom: 0; }
    .summary { margin: 0 0 20px; color: #9fb3ff; }
    .report-nav { margin: 10px 0 16px; display: flex; gap: 8px; flex-wrap: wrap; }
    .report-nav a {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      border: 1px solid #1f2a45;
      background: color-mix(in srgb, #11172d 75%, transparent);
      color: #9fb3ff;
      text-decoration: none;
      font-weight: 700;
      font-size: 13px;
    }
    .report-nav a:hover {
      border-color: color-mix(in srgb, #9fb3ff 40%, #1f2a45);
      background: color-mix(in srgb, #9fb3ff 16%, #11172d);
    }
    .report-link-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 6px 12px;
      border-radius: 10px;
      border: 1px solid color-mix(in srgb, #9fb3ff 35%, #1f2a45);
      background: color-mix(in srgb, #9fb3ff 14%, #11172d);
      color: #e8ecf5;
      text-decoration: none;
      font-weight: 700;
      font-size: 12px;
    }
    .report-link-btn:hover { background: color-mix(in srgb, #9fb3ff 22%, #11172d); }
    .report-section { margin-bottom: 18px; background: #11172d; border: 1px solid #1f2a45; border-radius: 10px; padding: 14px; }
    .snapshot-chips { display: flex; gap: 10px; flex-wrap: wrap; }
    .status-chip {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid #1f2a45;
      font-size: 12px;
      font-weight: 700;
    }
    .status-chip.info { color: #8fd5ff; }
    .status-chip.pass { color: #9ef5a1; }
    .status-chip.warn { color: #ffd27f; }
    .status-chip.fail { color: #ff8a8a; }
    .report-table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    .report-table th, .report-table td { border: 1px solid #1f2a45; padding: 8px; text-align: left; }
    .report-table th { background: #172b4e; }
    a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>Pa11y accessibility report</h1>
  <p class="summary">${pages.length} pages · ${totals.errors} errors · ${totals.warnings} warnings</p>
  ${renderCrossNav("pa11y/report.html")}
  <section class="report-section">
    <div class="snapshot-chips">
      <span class="status-chip info">${pages.length} Pages</span>
      <span class="status-chip ${pagesWithIssues > 0 ? "warn" : "pass"}">${pagesWithIssues} With issues</span>
      <span class="status-chip ${totals.errors > 0 ? "fail" : "pass"}">${totals.errors} Errors</span>
      <span class="status-chip ${totals.warnings > 0 ? "warn" : "pass"}">${totals.warnings} Warnings</span>
    </div>
  </section>
  <section class="report-section">
    <table class="report-table">
      <thead>
        <tr><th>URL</th><th>Errors</th><th>Warnings</th><th>Report</th></tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </section>
</body>
</html>`;

  const htmlPath = path.join(reportDir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

async function main() {
  let urls = [];
  if (URLS_FILE) {
    console.log(`🔍 Loading URLs from ${URLS_FILE} for Pa11y audit...`);
    urls = loadUrlsFromFile(URLS_FILE, BASE_URL);
  }
  if (!urls.length) {
    console.log(`🔍 Crawling site for Pa11y audit at ${BASE_URL}...`);
    urls = await crawl(BASE_URL);
  }
  console.log(`✅ Found ${urls.length} pages:`);
  urls.forEach((u) => console.log("  -", u));

  ensureDir(REPORT_DIR);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const url of urls) {
    console.log(`\n🧪 Running Pa11y on ${url}`);

    let result;
    try {
      result = await pa11y(url, {
        standard: "WCAG2AA",
        timeout: 30000,
        chromeLaunchConfig: {
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
          ],
        },
      });
    } catch (err) {
      console.error(`  ❌ Pa11y crashed on ${url}: ${err.message}`);
      totalErrors += 1;
      pageResults.push({
        url,
        issues: [{ type: "error", code: "pa11y-crash", message: err.message }],
      });
      continue;
    }

    const issues = result.issues || [];
    const errors = issues.filter((i) => i.type === "error").length;
    const warnings = issues.filter((i) => i.type === "warning").length;

    totalErrors += errors;
    totalWarnings += warnings;
    pageResults.push({ url, issues });
  }

  const summaryPath = writeMarkdownSummary(pageResults, REPORT_DIR);
  const { count: pageReportCount, reportPathByUrl } = writePa11yPageReports(
    pageResults,
    REPORT_DIR,
  );
  const htmlPath = writeHtmlReport(
    pageResults,
    { errors: totalErrors, warnings: totalWarnings },
    REPORT_DIR,
    reportPathByUrl,
  );

  // write stats for the orchestrator/PR comment
  const stats = {
    pagesTested: pageResults.length,
    errorCount: totalErrors,
    warningCount: totalWarnings,
  };
  const statsPath = path.join(REPORT_DIR, "stats.json");
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), "utf8");

  console.log(`\n📄 Pa11y summary (md): ${summaryPath}`);
  console.log(`📄 Pa11y report (html): ${htmlPath}`);
  console.log(
    `📄 Pa11y page reports (html): ${path.join(REPORT_DIR, "pages")} (${pageReportCount} files)`,
  );
  console.log(`📄 Pa11y stats (json): ${statsPath}`);
  console.log(
    `Totals: ${totalErrors} errors, ${totalWarnings} warnings across ${pageResults.length} pages.`,
  );

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error in Pa11y script:", err);
  process.exit(1);
});
