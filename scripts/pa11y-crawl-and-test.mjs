#!/usr/bin/env node

import pa11y from "pa11y";
import fs from "node:fs";
import path from "node:path";
import { load as loadHtml } from "cheerio";

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
      if (!visited.has(normalized) && !toVisit.has(normalized)) {
        toVisit.add(normalized);
      }
    });
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
        issue.context ? `  - Context: \`${String(issue.context).slice(0, 120)}\`` : "",
        ""
      );
    }
  }

  const summaryPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writeHtmlReport(pages, totals, reportDir) {
  const rows = pages
    .map((page) => {
      const issueRows = page.issues.length
        ? page.issues
            .map(
              (issue) => `
              <li class="${issue.type}">
                <div class="code">${escapeHtml(issue.code)}</div>
                <div>${escapeHtml(issue.message)}</div>
                <div class="meta"><span>${issue.type}</span> <code>${escapeHtml(issue.selector || "")}</code></div>
                ${issue.context ? `<pre>${escapeHtml(String(issue.context).slice(0, 500))}</pre>` : ""}
              </li>`
            )
            .join("")
        : '<li class="ok">No issues 🎉</li>';

      const counts = page.issues.reduce(
        (acc, issue) => {
          if (issue.type === "error") acc.errors += 1;
          if (issue.type === "warning") acc.warnings += 1;
          return acc;
        },
        { errors: 0, warnings: 0 }
      );

      return `
        <section class="page">
          <h2>${escapeHtml(page.url)}</h2>
          <div class="counts">
            <span class="error">${counts.errors} errors</span>
            <span class="warn">${counts.warnings} warnings</span>
          </div>
          <ul class="issues">
            ${issueRows}
          </ul>
        </section>
      `;
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
    .issues li.warning .code { color: #ffd27f; }
    .code { font-weight: 700; }
    .meta { font-size: 12px; color: #b8c4ff; margin-top: 4px; }
    pre { background: #0b1021; padding: 8px; border-radius: 4px; margin-top: 6px; overflow: auto; }
    a { color: #9fb3ff; }
  </style>
</head>
<body>
  <h1>Pa11y accessibility report</h1>
  <p class="summary">${pages.length} pages · ${totals.errors} errors · ${totals.warnings} warnings</p>
  ${rows}
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
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
        }
      });
    } catch (err) {
      console.error(`  ❌ Pa11y crashed on ${url}: ${err.message}`);
      totalErrors += 1;
      pageResults.push({
        url,
        issues: [{ type: "error", code: "pa11y-crash", message: err.message }]
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
  const htmlPath = writeHtmlReport(
    pageResults,
    { errors: totalErrors, warnings: totalWarnings },
    REPORT_DIR
  );

  // write stats for the orchestrator/PR comment
  const stats = {
    pagesTested: pageResults.length,
    errorCount: totalErrors,
    warningCount: totalWarnings
  };
  const statsPath = path.join(REPORT_DIR, "stats.json");
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2), "utf8");

  console.log(`\n📄 Pa11y summary (md): ${summaryPath}`);
  console.log(`📄 Pa11y report (html): ${htmlPath}`);
  console.log(`📄 Pa11y stats (json): ${statsPath}`);
  console.log(
    `Totals: ${totalErrors} errors, ${totalWarnings} warnings across ${pageResults.length} pages.`
  );

  if (totalErrors > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected error in Pa11y script:", err);
  process.exit(1);
});
