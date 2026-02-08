#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { load as loadHtml } from "cheerio";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR = process.env.SEO_REPORT_DIR || path.join(process.cwd(), "reports/seo");

const args = parseArgs(process.argv.slice(2));
const BASE_URL = args.base ?? DEFAULT_BASE_URL;
const REPORT_DIR = args.reportDir ?? DEFAULT_REPORT_DIR;
const URLS_FILE = args.urlsFile;

const visited = new Set();
const toVisit = new Set([BASE_URL]);
const internalLinksMap = new Map(); // targetUrl -> Set(pagesLinkingHere)
const httpStatusCache = new Map(); // url -> { status, ok }

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
    const $ = loadHtml(html);

    $("a[href]").each((_, el) => {
      let href = $(el).attr("href");
      if (!href) return;
      if (href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("#")) return;

      let absolute;
      try {
        absolute = href.startsWith("http") ? href : new URL(href, url).toString();
      } catch {
        return;
      }

      if (!isInternal(absolute)) return;
      const normalized = normalizeUrl(absolute);
      const fromPage = normalizeUrl(url);

      if (!internalLinksMap.has(normalized)) {
        internalLinksMap.set(normalized, new Set());
      }
      internalLinksMap.get(normalized).add(fromPage);

      if (!visited.has(normalized) && !toVisit.has(normalized)) {
        toVisit.add(normalized);
      }
    });
  }

  return Array.from(visited).sort();
}

function makeIssue(pageUrl, severity, code, message, extra = {}) {
  return { pageUrl, severity, code, message, ...extra };
}

function checkHeadingOrder($) {
  const headings = [];
  $("h1, h2, h3, h4, h5, h6").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    const level = parseInt(tag.replace("h", ""), 10);
    headings.push(level);
  });

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
  const $ = loadHtml(html);
  const issues = [];

  const pagePath = new URL(url).pathname;

  const htmlLang = $("html").attr("lang");
  if (!htmlLang) {
    issues.push(makeIssue(url, "error", "html-lang-missing", "<html> lang attribute is missing."));
  }

  const title = $("title").text().trim();
  if (!title) {
    issues.push(makeIssue(url, "error", "title-missing", "Page <title> is missing."));
  } else if (title.length < 30 || title.length > 65) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "title-length",
        `Page <title> length is ${title.length}, recommended 30–65.`
      )
    );
  }

  const desc = $('meta[name="description"]').attr("content")?.trim() || "";
  if (!desc) {
    issues.push(
      makeIssue(url, "error", "meta-description-missing", "Meta description is missing.")
    );
  } else if (desc.length < 50 || desc.length > 160) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "meta-description-length",
        `Meta description length is ${desc.length}, recommended 50–160.`
      )
    );
  }

  const viewport = $('meta[name="viewport"]').attr("content") || "";
  if (!viewport) {
    issues.push(
      makeIssue(url, "error", "viewport-missing", "Responsive viewport meta tag is missing.")
    );
  }

  const canonical = $('link[rel="canonical"]').attr("href");
  if (!canonical) {
    issues.push(makeIssue(url, "warn", "canonical-missing", "Canonical link is missing."));
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
      canonPath && pagePath ? canonPath === pagePath : normalizedCanon === normalizedUrl;
    if (!pathsMatch) {
      issues.push(
        makeIssue(
          url,
          "warn",
          "canonical-mismatch",
          `Canonical (${normalizedCanon}) does not match page URL (${normalizedUrl}).`
        )
      );
    }
  }

  const h1s = $("h1");
  if (h1s.length === 0) {
    issues.push(makeIssue(url, "error", "h1-missing", "No <h1> found on the page."));
  } else if (h1s.length > 1) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "h1-multiple",
        `Found ${h1s.length} <h1> elements; recommended exactly one.`
      )
    );
  }

  const jumps = checkHeadingOrder($);
  if (jumps.length > 0) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "heading-hierarchy",
        `Heading level jumps detected (e.g., h${jumps[0].prev} → h${jumps[0].curr}).`
      )
    );
  }

  const imagesMissingAlt = $("img").filter((_, el) => {
    const hasAltAttr = Object.prototype.hasOwnProperty.call(el.attribs || {}, "alt");
    return !hasAltAttr;
  }).length;

  if (imagesMissingAlt > 0) {
    issues.push(
      makeIssue(
        url,
        "error",
        "img-alt-missing",
        `${imagesMissingAlt} <img> elements are missing an alt attribute.`
      )
    );
  }

  const isMarketingPage =
    pagePath === "/" || pagePath.startsWith("/services") || pagePath.startsWith("/pricing");

  if (isMarketingPage) {
    const ogTitle = $('meta[property="og:title"]').attr("content");
    const ogDesc = $('meta[property="og:description"]').attr("content");
    const ogImage = $('meta[property="og:image"]').attr("content");

    if (!ogTitle) {
      issues.push(makeIssue(url, "warn", "og-title-missing", "Open Graph og:title is missing."));
    }
    if (!ogDesc) {
      issues.push(
        makeIssue(url, "warn", "og-description-missing", "Open Graph og:description is missing.")
      );
    }
    if (!ogImage) {
      issues.push(makeIssue(url, "warn", "og-image-missing", "Open Graph og:image is missing."));
    }
  }

  const jsonLdScripts = $('script[type="application/ld+json"]');
  if (jsonLdScripts.length === 0 && isMarketingPage) {
    issues.push(
      makeIssue(
        url,
        "warn",
        "jsonld-missing",
        "No JSON-LD structured data found on this key marketing page."
      )
    );
  }

  const robotsMeta = $('meta[name="robots"]').attr("content") || "";
  if (robotsMeta.toLowerCase().includes("noindex")) {
    issues.push(
      makeIssue(url, "error", "noindex-meta", "Page is marked as noindex via meta robots.")
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
        makeIssue(BASE_URL, "warn", "robots-missing", "robots.txt not found or not accessible.")
      );
    } else {
      const text = await robotsRes.text();
      if (/Disallow:\s*\/\s*$/m.test(text)) {
        siteWideIssues.push(
          makeIssue(
            BASE_URL,
            "error",
            "robots-disallow-all",
            "robots.txt appears to disallow all crawling."
          )
        );
      }
    }
  } catch {
    siteWideIssues.push(
      makeIssue(BASE_URL, "warn", "robots-error", "Error while fetching robots.txt.")
    );
  }

  try {
    const sitemapRes = await fetch(`${BASE_URL}/sitemap-index.xml`);
    if (!sitemapRes.ok) {
      siteWideIssues.push(
        makeIssue(BASE_URL, "warn", "sitemap-missing", "sitemap-index.xml not found or not accessible.")
      );
    }
  } catch {
    siteWideIssues.push(
      makeIssue(BASE_URL, "warn", "sitemap-error", "Error while fetching sitemap-index.xml.")
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

function writeMarkdownReport(urls, issuesByPage, reportDir) {
  const lines = ["# SEO audit report", ""];
  lines.push(`Tested pages: ${urls.length}`);
  const totalIssues = Array.from(issuesByPage.values()).reduce((acc, list) => acc + list.length, 0);
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
        `- ${issue.severity === "error" ? "❌" : "⚠️"} **${issue.code}** – ${issue.message}`
      );
    }
    lines.push("");
  }

  const summaryPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writeHtmlReport(issuesByPage, reportDir) {
  const sections = Array.from(issuesByPage.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([pageUrl, issues]) => {
      const issueItems = issues.length
        ? issues
            .map(
              (issue) => `<li class="${issue.severity}">
                <div class="code">${escapeHtml(issue.code)}</div>
                <div>${escapeHtml(issue.message)}</div>
                <div class="meta">${escapeHtml(issue.severity)}</div>
              </li>`
            )
            .join("")
        : '<li class="ok">No issues 🎉</li>';

      const counts = issues.reduce(
        (acc, issue) => {
          if (issue.severity === "error") acc.errors += 1;
          if (issue.severity === "warn") acc.warnings += 1;
          return acc;
        },
        { errors: 0, warnings: 0 }
      );

      return `
        <section class="page">
          <h2>${escapeHtml(pageUrl)}</h2>
          <div class="counts">
            <span class="error">${counts.errors} errors</span>
            <span class="warn">${counts.warnings} warnings</span>
          </div>
          <ul class="issues">
            ${issueItems}
          </ul>
        </section>
      `;
    })
    .join("\n");

  const totalErrors = Array.from(issuesByPage.values())
    .flat()
    .filter((i) => i.severity === "error").length;
  const totalWarnings = Array.from(issuesByPage.values())
    .flat()
    .filter((i) => i.severity === "warn").length;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>SEO audit report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; background: #0b1021; color: #e8ecf5; }
    h1 { margin-bottom: 0; }
    .summary { margin: 0 0 20px; color: #9fb3ff; }
    .page { background: #11172d; border: 1px solid #1f2a45; border-radius: 8px; padding: 16px; margin-bottom: 18px; }
    .page h2 { margin: 0 0 6px; font-size: 18px; }
    .counts { font-size: 13px; margin-bottom: 10px; }
    .counts .error { color: #ff8a8a; margin-right: 10px; }
    .counts .warn { color: #ffd27f; }
    .issues { list-style: none; padding: 0; margin: 0; }
    .issues li { border-top: 1px solid #1f2a45; padding: 10px 0; }
    .issues li:first-child { border-top: none; }
    .issues li.ok { color: #9ef5a1; font-weight: 600; }
    .issues li.error .code { color: #ff8a8a; }
    .issues li.warn .code { color: #ffd27f; }
    .code { font-weight: 700; }
    .meta { font-size: 12px; color: #b8c4ff; margin-top: 4px; }
    a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>SEO audit report</h1>
  <p class="summary">${issuesByPage.size} pages · ${totalErrors} errors · ${totalWarnings} warnings</p>
  ${sections}
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
        makeIssue(url, "error", "page-fetch-error", `Failed to fetch page: ${err.message}`)
      );
      continue;
    }

    if (!res.ok) {
      allIssues.push(
        makeIssue(url, "error", "page-http-error", `Page responded with HTTP ${res.status}.`)
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
          `Internal link target returned HTTP ${status}. Linked from: ${fromPages.join(", ")}`
        )
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
  const htmlPath = writeHtmlReport(issuesByPage, REPORT_DIR);
  const stats = {
    pagesTested: urls.length,
    errorCount: allIssues.filter((i) => i.severity === "error").length,
    warningCount: allIssues.filter((i) => i.severity === "warn").length
  };
  const statsPath = path.join(REPORT_DIR, "stats.json");
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), "utf8");

  console.log(`\n📄 SEO report written to:`);
  console.log(`   - ${summaryPath}`);
  console.log(`   - ${htmlPath}`);
  console.log(`   - ${jsonPath}`);
  console.log(`   - ${statsPath}`);

  const errorCount = allIssues.filter((i) => i.severity === "error").length;
  if (errorCount > 0) {
    console.error(`\n🚫 SEO audit failed: ${errorCount} error-level issues found.`);
    process.exit(1);
  }

  console.log(`\n🎉 SEO audit passed: no error-level issues found.`);
}

main().catch((err) => {
  console.error("Unexpected error in SEO audit:", err);
  process.exit(1);
});
