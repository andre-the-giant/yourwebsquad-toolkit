#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { parse } from "node-html-parser";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR =
  process.env.SEO_REPORT_DIR || path.join(process.cwd(), "reports/seo");

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.base ?? DEFAULT_BASE_URL;
const REPORT_DIR = args.reportDir ?? DEFAULT_REPORT_DIR;
const URLS_FILE = args.urlsFile;

const visited = new Set();
const toVisit = new Set([BASE_URL]);
const internalLinksMap = new Map(); // targetUrl -> Set(pagesLinkingHere)
const httpStatusCache = new Map(); // url -> { status, ok }
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

function loadUrlsFromFile(file, baseUrl) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((u) => {
          try {
            return normalizeUrl(new URL(u, baseUrl).toString());
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

async function crawl() {
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
      const fromPage = normalizeUrl(url);

      if (!internalLinksMap.has(normalized)) {
        internalLinksMap.set(normalized, new Set());
      }
      internalLinksMap.get(normalized).add(fromPage);

      if (!visited.has(normalized) && !toVisit.has(normalized)) {
        toVisit.add(normalized);
      }
    }
  }

  return Array.from(visited).sort();
}

function makeIssue(pageUrl, severity, code, message, extra = {}) {
  return { pageUrl, severity, code, message, ...extra };
}

function buildCrossNavLinks(currentReportPath, options = {}) {
  const currentFile = String(currentReportPath || "seo/report.html").replace(
    /\\/g,
    "/",
  );
  const currentDir = path.posix.dirname(currentFile);
  const excludeKeys = new Set(options.excludeKeys || []);
  const reportsRoot = path.resolve(REPORT_DIR, "..");

  return REPORT_NAV_MODEL.filter((item) => !excludeKeys.has(item.key))
    .map((item) => {
      if (item.href) return { ...item, href: item.href };
      const target = String(item.path || "").replace(/\\/g, "/");
      if (!target) return null;
      const absTarget = path.join(reportsRoot, target);
      if (!fs.existsSync(absTarget)) return null;
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

function checkHeadingOrder(root) {
  const headings = [];
  for (const el of root.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
    const tag = (el.rawTagName || "").toLowerCase();
    const level = Number.parseInt(tag.replace("h", ""), 10);
    headings.push(level);
  }

  const jumps = [];
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const curr = headings[i];
    if (curr - prev > 1) {
      jumps.push({ prev, curr });
    }
  }
  return jumps;
}

async function checkUrlStatus(url) {
  if (httpStatusCache.has(url)) return httpStatusCache.get(url);
  try {
    const res = await fetch(url, { method: "HEAD" });
    const info = { status: res.status, ok: res.ok };
    httpStatusCache.set(url, info);
    return info;
  } catch {
    const info = { status: 0, ok: false };
    httpStatusCache.set(url, info);
    return info;
  }
}

function runSeoChecks(url, html) {
  const root = parse(html);
  const issues = [];

  const pagePath = new URL(url).pathname;

  const htmlLang = root.querySelector("html")?.getAttribute("lang");
  if (!htmlLang) {
    issues.push(
      makeIssue(
        url,
        "error",
        "html-lang-missing",
        "<html> lang attribute is missing.",
      ),
    );
  }

  const title = (root.querySelector("title")?.text || "").trim();
  if (!title) {
    issues.push(
      makeIssue(url, "error", "title-missing", "Page <title> is missing."),
    );
  } else if (title.length < 30 || title.length > 65) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "title-length",
        `Page <title> length is ${title.length}, recommended 30–65.`,
      ),
    );
  }

  const desc =
    root
      .querySelector('meta[name="description"]')
      ?.getAttribute("content")
      ?.trim() || "";
  if (!desc) {
    issues.push(
      makeIssue(
        url,
        "error",
        "meta-description-missing",
        "Meta description is missing.",
      ),
    );
  } else if (desc.length < 50 || desc.length > 160) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "meta-description-length",
        `Meta description length is ${desc.length}, recommended 50–160.`,
      ),
    );
  }

  const viewport =
    root.querySelector('meta[name="viewport"]')?.getAttribute("content") || "";
  if (!viewport) {
    issues.push(
      makeIssue(
        url,
        "error",
        "viewport-missing",
        "Responsive viewport meta tag is missing.",
      ),
    );
  }

  const canonical = root
    .querySelector('link[rel="canonical"]')
    ?.getAttribute("href");
  if (!canonical) {
    issues.push(
      makeIssue(url, "warn", "canonical-missing", "Canonical link is missing."),
    );
  } else {
    const normalizedCanon = normalizeUrl(new URL(canonical, url).toString());
    const normalizedUrl = normalizeUrl(url);

    let canonPath = "";
    let pagePath = "";
    try {
      const canonUrl = new URL(normalizedCanon);
      const pageUrl = new URL(normalizedUrl);
      canonPath = `${canonUrl.pathname || ""}${canonUrl.search || ""}`;
      pagePath = `${pageUrl.pathname || ""}${pageUrl.search || ""}`;
    } catch {
      // fall back to strict compare below
    }

    const pathsMatch =
      canonPath && pagePath
        ? canonPath === pagePath
        : normalizedCanon === normalizedUrl;
    if (!pathsMatch) {
      issues.push(
        makeIssue(
          url,
          "warn",
          "canonical-mismatch",
          `Canonical (${normalizedCanon}) does not match page URL (${normalizedUrl}).`,
        ),
      );
    }
  }

  const h1s = root.querySelectorAll("h1");
  if (h1s.length === 0) {
    issues.push(
      makeIssue(url, "error", "h1-missing", "No <h1> found on the page."),
    );
  } else if (h1s.length > 1) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "h1-multiple",
        `Found ${h1s.length} <h1> elements; recommended exactly one.`,
      ),
    );
  }

  const jumps = checkHeadingOrder(root);
  if (jumps.length > 0) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "heading-hierarchy",
        `Heading level jumps detected (e.g., h${jumps[0].prev} → h${jumps[0].curr}).`,
      ),
    );
  }

  const imagesMissingAlt = root
    .querySelectorAll("img")
    .filter(
      (el) => !Object.prototype.hasOwnProperty.call(el.attributes || {}, "alt"),
    ).length;

  if (imagesMissingAlt > 0) {
    issues.push(
      makeIssue(
        url,
        "error",
        "img-alt-missing",
        `${imagesMissingAlt} <img> elements are missing an alt attribute.`,
      ),
    );
  }

  const isMarketingPage =
    pagePath === "/" ||
    pagePath.startsWith("/services") ||
    pagePath.startsWith("/pricing");

  if (isMarketingPage) {
    const ogTitle = root
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content");
    const ogDesc = root
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");
    const ogImage = root
      .querySelector('meta[property="og:image"]')
      ?.getAttribute("content");

    if (!ogTitle) {
      issues.push(
        makeIssue(
          url,
          "warn",
          "og-title-missing",
          "Open Graph og:title is missing.",
        ),
      );
    }
    if (!ogDesc) {
      issues.push(
        makeIssue(
          url,
          "warn",
          "og-description-missing",
          "Open Graph og:description is missing.",
        ),
      );
    }
    if (!ogImage) {
      issues.push(
        makeIssue(
          url,
          "warn",
          "og-image-missing",
          "Open Graph og:image is missing.",
        ),
      );
    }
  }

  const jsonLdScripts = root.querySelectorAll(
    'script[type="application/ld+json"]',
  );
  if (jsonLdScripts.length === 0 && isMarketingPage) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "jsonld-missing",
        "No JSON-LD structured data found on this key marketing page.",
      ),
    );
  }

  const robotsMeta =
    root.querySelector('meta[name="robots"]')?.getAttribute("content") || "";
  if (robotsMeta.toLowerCase().includes("noindex")) {
    issues.push(
      makeIssue(
        url,
        "error",
        "noindex-meta",
        "Page is marked as noindex via meta robots.",
      ),
    );
  }

  return issues;
}

async function checkSiteWide() {
  const siteWideIssues = [];

  try {
    const robotsRes = await fetch(`${BASE_URL}/robots.txt`);
    if (!robotsRes.ok) {
      siteWideIssues.push(
        makeIssue(
          BASE_URL,
          "warn",
          "robots-missing",
          "robots.txt not found or not accessible.",
        ),
      );
    } else {
      const text = await robotsRes.text();
      if (/Disallow:\s*\/\s*$/m.test(text)) {
        siteWideIssues.push(
          makeIssue(
            BASE_URL,
            "error",
            "robots-disallow-all",
            "robots.txt appears to disallow all crawling.",
          ),
        );
      }
    }
  } catch {
    siteWideIssues.push(
      makeIssue(
        BASE_URL,
        "warn",
        "robots-error",
        "Error while fetching robots.txt.",
      ),
    );
  }

  try {
    const sitemapRes = await fetch(`${BASE_URL}/sitemap-index.xml`);
    if (!sitemapRes.ok) {
      siteWideIssues.push(
        makeIssue(
          BASE_URL,
          "warn",
          "sitemap-missing",
          "sitemap-index.xml not found or not accessible.",
        ),
      );
    }
  } catch {
    siteWideIssues.push(
      makeIssue(
        BASE_URL,
        "warn",
        "sitemap-error",
        "Error while fetching sitemap-index.xml.",
      ),
    );
  }

  return siteWideIssues;
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

function writeSeoPageReports(urls, issuesByPage, reportDir) {
  const pagesDir = path.join(reportDir, "pages");
  fs.rmSync(pagesDir, { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });
  const reportPathByUrl = new Map();

  const pageUrls = Array.from(
    new Set([...urls, ...Array.from(issuesByPage.keys())]),
  ).sort((a, b) => a.localeCompare(b));

  for (let index = 0; index < pageUrls.length; index += 1) {
    const pageUrl = pageUrls[index];
    const issues = issuesByPage.get(pageUrl) || [];
    const fileName = pageReportFileName(pageUrl, index);
    const counts = issues.reduce(
      (acc, issue) => {
        if (issue.severity === "error") acc.errors += 1;
        if (issue.severity === "warn") acc.warnings += 1;
        return acc;
      },
      { errors: 0, warnings: 0 },
    );

    const issueRows = issues.length
      ? issues
          .map(
            (issue) => `<tr>
              <td>${escapeHtml(issue.code)}</td>
              <td>${escapeHtml(issue.severity)}</td>
              <td>${escapeHtml(issue.message)}</td>
            </tr>`,
          )
          .join("\n")
      : '<tr><td colspan="3">No issues 🎉</td></tr>';

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SEO page report</title>
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
    .report-table th, .report-table td { border: 1px solid #1f2a45; padding: 8px; text-align: left; }
    .report-table th { background: #172b4e; }
  </style>
</head>
<body>
  <h1>SEO page report</h1>
  <p class="summary">${escapeHtml(pageUrl)}</p>
  ${renderCrossNav(`seo/pages/${fileName}`)}
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
        <tr><th>Code</th><th>Severity</th><th>Message</th></tr>
      </thead>
      <tbody>
        ${issueRows}
      </tbody>
    </table>
  </section>
</body>
</html>`;

    fs.writeFileSync(path.join(pagesDir, fileName), html, "utf8");
    reportPathByUrl.set(pageUrl, `./pages/${fileName}`);
  }

  return { count: pageUrls.length, reportPathByUrl };
}

function writeMarkdownReport(urls, issuesByPage, reportDir) {
  const lines = ["# SEO audit report", ""];
  lines.push(`Tested pages: ${urls.length}`);
  const totalIssues = Array.from(issuesByPage.values()).reduce(
    (acc, list) => acc + list.length,
    0,
  );
  lines.push(`Total issues: ${totalIssues}`);
  lines.push("");

  const pagesSorted = Array.from(issuesByPage.keys()).sort();
  for (const pageUrl of pagesSorted) {
    lines.push(`## ${pageUrl}`);
    const pageIssues = issuesByPage.get(pageUrl) || [];
    if (!pageIssues.length) {
      lines.push("- ✅ No issues", "");
      continue;
    }
    for (const issue of pageIssues) {
      lines.push(
        `- ${issue.severity === "error" ? "❌" : "⚠️"} **${issue.code}** – ${issue.message}`,
      );
    }
    lines.push("");
  }

  const summaryPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writeHtmlReport(issuesByPage, reportDir, reportPathByUrl = new Map()) {
  const tableRows = Array.from(issuesByPage.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pageUrl, issues]) => {
      const counts = issues.reduce(
        (acc, issue) => {
          if (issue.severity === "error") acc.errors += 1;
          if (issue.severity === "warn") acc.warnings += 1;
          return acc;
        },
        { errors: 0, warnings: 0 },
      );
      const reportHref = reportPathByUrl.get(pageUrl);
      const reportLink = reportHref
        ? `<a class="report-link-btn" href="${escapeHtml(reportHref)}">report</a>`
        : "-";
      return `<tr>
        <td>${escapeHtml(pageUrl)}</td>
        <td>${counts.errors}</td>
        <td>${counts.warnings}</td>
        <td>${reportLink}</td>
      </tr>`;
    })
    .join("\n");

  const totalErrors = Array.from(issuesByPage.values())
    .flat()
    .filter((i) => i.severity === "error").length;
  const totalWarnings = Array.from(issuesByPage.values())
    .flat()
    .filter((i) => i.severity === "warn").length;
  const pagesWithIssues = Array.from(issuesByPage.values()).filter(
    (issues) => issues.length > 0,
  ).length;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SEO audit report</title>
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
  <h1>SEO audit report</h1>
  <p class="summary">${issuesByPage.size} pages · ${totalErrors} errors · ${totalWarnings} warnings</p>
  ${renderCrossNav("seo/report.html")}
  <section class="report-section">
    <div class="snapshot-chips">
      <span class="status-chip info">${issuesByPage.size} Pages</span>
      <span class="status-chip ${pagesWithIssues > 0 ? "warn" : "pass"}">${pagesWithIssues} With issues</span>
      <span class="status-chip ${totalErrors > 0 ? "fail" : "pass"}">${totalErrors} Errors</span>
      <span class="status-chip ${totalWarnings > 0 ? "warn" : "pass"}">${totalWarnings} Warnings</span>
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
    console.log(`🔍 Loading URLs from ${URLS_FILE} for SEO audit...`);
    urls = loadUrlsFromFile(URLS_FILE, BASE_URL);
  }
  if (!urls.length) {
    console.log(`🔍 Crawling site for SEO audit at ${BASE_URL}...`);
    urls = await crawl();
  }
  console.log(`✅ Found ${urls.length} pages:`);
  urls.forEach((u) => console.log("  -", u));

  const allIssues = [];

  for (const url of urls) {
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      allIssues.push(
        makeIssue(
          url,
          "error",
          "page-fetch-error",
          `Failed to fetch page: ${err.message}`,
        ),
      );
      continue;
    }

    if (!res.ok) {
      allIssues.push(
        makeIssue(
          url,
          "error",
          "page-http-error",
          `Page responded with HTTP ${res.status}.`,
        ),
      );
      continue;
    }

    const html = await res.text();
    const pageIssues = runSeoChecks(url, html);
    allIssues.push(...pageIssues);
  }

  console.log("\n🔗 Checking internal links...");
  const linkTargets = Array.from(internalLinksMap.keys());
  for (const target of linkTargets) {
    const { status, ok } = await checkUrlStatus(target);
    if (!ok) {
      const fromPages = Array.from(internalLinksMap.get(target));
      allIssues.push(
        makeIssue(
          target,
          "error",
          "broken-internal-link",
          `Internal link target returned HTTP ${status}. Linked from: ${fromPages.join(", ")}`,
        ),
      );
    }
  }

  const siteWideIssues = await checkSiteWide();
  allIssues.push(...siteWideIssues);

  ensureDir(REPORT_DIR);

  const issuesByPage = new Map();
  for (const issue of allIssues) {
    if (!issuesByPage.has(issue.pageUrl)) issuesByPage.set(issue.pageUrl, []);
    issuesByPage.get(issue.pageUrl).push(issue);
  }

  const jsonPath = path.join(REPORT_DIR, "issues.json");
  fs.writeFileSync(jsonPath, JSON.stringify(allIssues, null, 2), "utf8");

  const summaryPath = writeMarkdownReport(urls, issuesByPage, REPORT_DIR);
  const { count: pageReportCount, reportPathByUrl } = writeSeoPageReports(
    urls,
    issuesByPage,
    REPORT_DIR,
  );
  const htmlPath = writeHtmlReport(issuesByPage, REPORT_DIR, reportPathByUrl);
  const stats = {
    pagesTested: urls.length,
    errorCount: allIssues.filter((i) => i.severity === "error").length,
    warningCount: allIssues.filter((i) => i.severity === "warn").length,
  };
  const statsPath = path.join(REPORT_DIR, "stats.json");
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), "utf8");

  console.log(`\n📄 SEO report written to:`);
  console.log(`   - ${summaryPath}`);
  console.log(`   - ${htmlPath}`);
  console.log(
    `   - ${path.join(REPORT_DIR, "pages")} (${pageReportCount} files)`,
  );
  console.log(`   - ${jsonPath}`);
  console.log(`   - ${statsPath}`);

  const errorCount = allIssues.filter((i) => i.severity === "error").length;
  if (errorCount > 0) {
    console.error(
      `\n🚫 SEO audit failed: ${errorCount} error-level issues found.`,
    );
    process.exit(1);
  }

  console.log(`\n🎉 SEO audit passed: no error-level issues found.`);
}

main().catch((err) => {
  console.error("Unexpected error in SEO audit:", err);
  process.exit(1);
});
