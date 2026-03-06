#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import waitOn from "wait-on";
import { parse } from "node-html-parser";

const DEFAULT_BASE_URL = process.env.BASE_URL || "http://localhost:4321";
const DEFAULT_REPORT_DIR =
  process.env.LINK_REPORT_DIR || path.join(process.cwd(), "reports/links");
const DEFAULT_SITE_PORT = Number(process.env.SITE_PORT || 4321);

const args = parseArgs(process.argv.slice(2));
const RAW_BASE_URL = args.base ?? DEFAULT_BASE_URL;
const BASE_URL = preferIpv4Loopback(RAW_BASE_URL);
const REPORT_DIR = args.reportDir ?? DEFAULT_REPORT_DIR;
const URLS_FILE = args.urlsFile;
const CHECK_EXTERNAL = args.skipExternal
  ? false
  : process.env.CHECK_EXTERNAL_LINKS !== "0";
const QUIET_MODE = Boolean(args.quiet || process.env.LINKS_QUIET === "1");
const EXTERNAL_BOT_PROTECTION_HOSTS = new Set(
  (
    process.env.LINK_CHECK_BOT_PROTECTION_HOSTS ||
    "homestars.com,www.homestars.com"
  )
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean),
);

const visited = new Set();
const toVisit = new Set([BASE_URL]);
const linkCache = new Map(); // normalizedUrl -> result
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
    } else if (arg === "--skip-external") {
      opts.skipExternal = true;
    } else if (arg === "--quiet") {
      opts.quiet = true;
    }
  }
  return opts;
}

function sitePortFromBase() {
  try {
    const u = new URL(BASE_URL);
    return Number(u.port) || DEFAULT_SITE_PORT;
  } catch {
    return DEFAULT_SITE_PORT;
  }
}

async function waitForServer(url) {
  await waitOn({ resources: [url], timeout: 20000 });
}

function resolveCommandForSpawn(cmd) {
  if (process.platform !== "win32") return cmd;
  const name = String(cmd || "").toLowerCase();
  if (name === "npm" || name === "npx") {
    return `${cmd}.cmd`;
  }
  return cmd;
}

function runCommand(cmd, args, { label = cmd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(resolveCommandForSpawn(cmd), args, {
      stdio: "inherit",
      shell: false,
    });
    child.on("exit", (code) => {
      if (code === 0) return resolve();
      reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function startStaticServer(dir, port, { quiet = QUIET_MODE } = {}) {
  const args = [
    "serve",
    "-l",
    `tcp://127.0.0.1:${port}`,
    "--no-port-switching",
    dir,
  ];
  const opts = quiet
    ? { stdio: "ignore", shell: false }
    : { stdio: "inherit", shell: false };
  const child = spawn(resolveCommandForSpawn("npx"), args, opts);
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !quiet) {
      console.error(`⚠️  Static server exited with code ${code}`);
    }
  });
  return child;
}

function ensureReportDirClean(dir) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  fs.mkdirSync(dir, { recursive: true });
}

async function ensureBuildExists() {
  const buildDir = path.join(process.cwd(), "build");
  const hasBuild = fs.existsSync(buildDir);
  if (hasBuild) return;
  if (!QUIET_MODE)
    console.log("🏗️  No build found, running npm run build for link check...");
  await runCommand("npm", ["run", "build"], { label: "npm run build" });
}

async function ensureSiteServer() {
  let healthy = false;
  try {
    const res = await fetchWithTimeout(BASE_URL, "HEAD");
    healthy = res && res.ok;
  } catch {
    healthy = false;
  }

  if (healthy) return null;

  await ensureBuildExists();
  const port = sitePortFromBase();
  const server = startStaticServer("./build", port, { quiet: QUIET_MODE });
  await waitForServer(BASE_URL);
  if (!QUIET_MODE) {
    console.log(`✅ Started static server for link check at ${BASE_URL}`);
  }
  return server;
}

function fileExistsForPath(pathname) {
  const clean = pathname.replace(/^\/+/, "").replace(/\/$/, "");
  const dirPath = path.join(process.cwd(), "build", clean);
  const indexPath = path.join(dirPath, "index.html");
  const directHtml = path.join(process.cwd(), "build", `${clean}.html`);
  return fs.existsSync(indexPath) || fs.existsSync(directHtml);
}

function getUrlsFromSitemap(baseUrl) {
  const candidates = [
    path.join(process.cwd(), "build", "sitemap-0.xml"),
    path.join(process.cwd(), "build", "sitemap.xml"),
  ];
  const sitemapPath = candidates.find(fs.existsSync);
  if (!sitemapPath) return [];
  try {
    const xml = fs.readFileSync(sitemapPath, "utf8");
    const urls = new Set();
    const matches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
    for (const match of matches) {
      const loc = (match[1] || "").replaceAll("&amp;", "&").trim();
      if (!loc) continue;
      let pathname;
      try {
        pathname = new URL(loc).pathname;
      } catch {
        continue;
      }
      if (!pathname.startsWith("/en") && !pathname.startsWith("/fr")) continue;
      if (!fileExistsForPath(pathname)) continue;
      const target = new URL(pathname, baseUrl).toString();
      urls.add(normalizeUrl(target));
    }
    return Array.from(urls).sort();
  } catch {
    return [];
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    // Keep trailing slashes so trailingSlash:"always" projects stay canonical.
    return u.toString();
  } catch {
    return url;
  }
}

function preferIpv4Loopback(url) {
  try {
    const u = new URL(url);
    const host = String(u.hostname || "").toLowerCase();
    if (host === "localhost" || host === "::1") {
      u.hostname = "127.0.0.1";
    }
    return u.toString();
  } catch {
    return url;
  }
}

function isIgnoredScheme(href) {
  const value = (href || "").trim().toLowerCase();
  return (
    value.startsWith("mailto:") ||
    value.startsWith("tel:") ||
    value.startsWith("sms:") ||
    value.startsWith("javascript:") ||
    value.startsWith("#")
  );
}

function hasClassAncestor(el, className) {
  let current = el;
  while (current && current.rawTagName) {
    const classes = (current.getAttribute?.("class") || "")
      .split(/\s+/)
      .filter(Boolean);
    if (classes.includes(className)) return true;
    current = current.parentNode;
  }
  return false;
}

function shouldSkipLink(el, href) {
  if (isIgnoredScheme(href)) return true;

  // GoogleReviews outputs a "more-reviews" link that is hidden client-side.
  // Skip it to avoid false positives in static HTML checks.
  if (hasClassAncestor(el, "more-reviews")) return true;

  return false;
}

function getHost(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isInternal(url) {
  return normalizeUrl(url).startsWith(normalizeUrl(BASE_URL));
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

async function fetchWithTimeout(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    return await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkLink(url, isExternal) {
  const normalized = normalizeUrl(url);
  if (linkCache.has(normalized)) return linkCache.get(normalized);

  if (isExternal && !CHECK_EXTERNAL) {
    const skipped = {
      url: normalized,
      ok: true,
      skipped: true,
      isExternal,
      status: 0,
    };
    linkCache.set(normalized, skipped);
    return skipped;
  }

  let res;
  let error;
  let headStatus = null;
  let headError = null;
  let fallbackUsed = false;

  try {
    res = await fetchWithTimeout(normalized, "HEAD");
    headStatus = Number(res?.status || 0) || null;
  } catch (err) {
    error = err;
    headError = err?.message || "HEAD request failed";
  }

  const shouldFallbackToGet = !res || (!res.ok && res.status >= 400);
  if (shouldFallbackToGet) {
    fallbackUsed = true;
    try {
      const getRes = await fetchWithTimeout(normalized, "GET");
      res = getRes;
      error = null;
    } catch (err) {
      if (!res) {
        error = err;
      }
    }
  }

  if (!res) {
    const result = {
      url: normalized,
      ok: false,
      status: 0,
      error: error?.message || "Request failed",
      isExternal,
      headStatus,
      headError,
      fallbackUsed,
      method: fallbackUsed ? "GET" : "HEAD",
    };
    linkCache.set(normalized, result);
    return result;
  }

  const result = {
    url: normalized,
    ok: res.ok,
    status: res.status,
    isExternal,
    finalUrl: res.url,
    headStatus,
    headError,
    fallbackUsed,
    method: fallbackUsed ? "GET" : "HEAD",
  };

  if (isExternal && res.status === 403) {
    const host = getHost(normalized);
    const isBotProtected = EXTERNAL_BOT_PROTECTION_HOSTS.has(host);
    const cloudflareChallenge = Boolean(res.headers.get("cf-mitigated"));
    if (isBotProtected || cloudflareChallenge) {
      const skipped = {
        ...result,
        ok: true,
        skipped: true,
      };
      linkCache.set(normalized, skipped);
      return skipped;
    }
  }

  linkCache.set(normalized, result);
  return result;
}

function formatStatusText(link) {
  if (link?.skipped) return "skipped";
  const statusPart = link?.status ? String(link.status) : "unknown";
  const scopePart = link?.isExternal ? "external" : null;
  const fallbackPart = link?.fallbackUsed
    ? `fallback: HEAD ${
        Number.isFinite(link?.headStatus) && link.headStatus > 0
          ? link.headStatus
          : "failed"
      } -> GET`
    : null;
  return [statusPart, scopePart, fallbackPart].filter(Boolean).join(" · ");
}

function formatIssueStatusText(issue) {
  const scope = issue?.isExternal ? "external" : "internal";
  const statusCore = issue?.status
    ? `status ${issue.status}`
    : issue?.error || "failed";
  const fallback =
    issue?.fallbackUsed && !issue?.error
      ? `, fallback HEAD ${issue?.headStatus || "failed"} -> GET`
      : issue?.fallbackUsed && issue?.error
        ? ", fallback GET failed"
        : "";
  return `${statusCore}${fallback}, ${scope}`;
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
      if (shouldSkipLink(anchor, href)) continue;

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

function filterPagesForReport(pages, { brokenOnly = false } = {}) {
  return brokenOnly
    ? pages
        .map((page) => {
          const brokenLinks = page.links.filter((l) => !l.ok && !l.skipped);
          return brokenLinks.length ? { ...page, links: brokenLinks } : null;
        })
        .filter(Boolean)
    : pages;
}

function buildCrossNavLinks(currentReportPath, options = {}) {
  const currentFile = String(currentReportPath || "links/report.html").replace(
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

function buildSelector(el) {
  const parts = [];
  let current = el;
  while (current && current.rawTagName) {
    const name = (current.rawTagName || "").toLowerCase() || "elem";
    const id = current.getAttribute?.("id");
    const classes = (current.getAttribute?.("class") || "")
      .split(/\s+/)
      .filter(Boolean);
    if (id) {
      parts.unshift(`${name}#${id}`);
      break;
    }
    let piece = name;
    if (classes.length) {
      piece += `.${classes[0]}`;
    }
    const siblings =
      current.parentNode?.childNodes?.filter(
        (child) => child.rawTagName === current.rawTagName,
      ) || [];
    if (siblings.length > 1) {
      const index = siblings.indexOf(current);
      if (index >= 0) piece += `:nth-of-type(${index + 1})`;
    }
    parts.unshift(piece);
    current = current.parentNode;
  }
  return parts.length ? parts.join(" > ") : "unknown";
}

function writeMarkdown(pages, broken, skippedExternal, reportDir) {
  const lines = ["# Link check report", ""];
  lines.push(`Pages crawled: ${pages.length}`);
  lines.push(`Broken links: ${broken.length}`);
  if (skippedExternal > 0) {
    lines.push(
      `External links skipped (set CHECK_EXTERNAL_LINKS=1 to include): ${skippedExternal}`,
    );
  }
  lines.push("");

  if (broken.length === 0) {
    lines.push("✅ No broken links found.");
  } else {
    for (const issue of broken) {
      lines.push(
        `- ${issue.pageUrl} → ${issue.linkUrl} (${formatIssueStatusText(issue)})`,
      );
      if (issue.selector) lines.push(`  - Selector: \`${issue.selector}\``);
      if (issue.text) lines.push(`  - Text: ${issue.text}`);
      if (issue.error) lines.push(`  - Error: ${issue.error}`);
    }
  }

  const summaryPath = path.join(reportDir, "SUMMARY.md");
  fs.writeFileSync(summaryPath, lines.join("\n"), "utf8");
  return summaryPath;
}

function writeLinkPageReports(pages, reportDir, { brokenOnly = false } = {}) {
  const filteredPages = filterPagesForReport(pages, { brokenOnly });
  const pagesDir = path.join(reportDir, "pages");
  fs.rmSync(pagesDir, { recursive: true, force: true });
  fs.mkdirSync(pagesDir, { recursive: true });
  const reportPathByUrl = new Map();

  for (let index = 0; index < filteredPages.length; index += 1) {
    const page = filteredPages[index];
    const fileName = pageReportFileName(page.url, index);
    const brokenCount = page.links.filter((l) => !l.ok && !l.skipped).length;
    const checkedCount = page.links.filter((l) => !l.skipped).length;
    const skippedCount = page.links.filter((l) => l.skipped).length;

    const rows = page.links.length
      ? page.links
          .map((link) => {
            const statusClass = !link.ok
              ? "fail"
              : link.skipped
                ? "warn"
                : "pass";
            return `<tr>
              <td>${escapeHtml(link.linkUrl || "")}</td>
              <td><span class="status-chip ${statusClass}">${escapeHtml(formatStatusText(link))}</span></td>
              <td>${escapeHtml(link.selector || "")}</td>
              <td>${escapeHtml(link.text || "")}</td>
              <td>${escapeHtml(link.error || "")}</td>
            </tr>`;
          })
          .join("\n")
      : '<tr><td colspan="5">No links found.</td></tr>';

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Link page report</title>
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
  </style>
</head>
<body>
  <h1>Link page report</h1>
  <p class="summary">${escapeHtml(page.url)}</p>
  ${renderCrossNav(`links/pages/${fileName}`)}
  <section class="report-section">
    <div class="snapshot-chips">
      <span class="status-chip info">1 Page</span>
      <span class="status-chip ${brokenCount > 0 ? "fail" : "pass"}">${brokenCount} Broken</span>
      <span class="status-chip info">${checkedCount} Checked</span>
      <span class="status-chip ${skippedCount > 0 ? "warn" : "pass"}">${skippedCount} Skipped</span>
    </div>
  </section>
  <section class="report-section">
    <table class="report-table">
      <thead>
        <tr><th>URL</th><th>Status</th><th>Selector</th><th>Text</th><th>Error</th></tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  </section>
</body>
</html>`;

    fs.writeFileSync(path.join(pagesDir, fileName), html, "utf8");
    reportPathByUrl.set(page.url, `./pages/${fileName}`);
  }

  return { count: filteredPages.length, reportPathByUrl };
}

function writeHtml(
  pages,
  broken,
  skippedExternal,
  reportDir,
  reportPathByUrl = new Map(),
  { brokenOnly = false } = {},
) {
  const filteredPages = filterPagesForReport(pages, { brokenOnly });
  const pagesWithBrokenLinks = filteredPages.filter((page) =>
    page.links.some((l) => !l.ok && !l.skipped),
  ).length;
  const tableRows = filteredPages
    .map((page) => {
      const brokenCount = page.links.filter((l) => !l.ok && !l.skipped).length;
      const checkedCount = page.links.filter((l) => !l.skipped).length;
      const skippedCount = page.links.filter((l) => l.skipped).length;
      const reportHref = reportPathByUrl.get(page.url);
      const reportLink = reportHref
        ? `<a class="report-link-btn" href="${escapeHtml(reportHref)}">report</a>`
        : "-";
      return `<tr>
        <td>${escapeHtml(page.url)}</td>
        <td>${brokenCount}</td>
        <td>${checkedCount}</td>
        <td>${skippedCount}</td>
        <td>${reportLink}</td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Link check report</title>
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
  <h1>Link check report</h1>
  <p class="summary">${filteredPages.length} pages · ${broken.length} broken links${skippedExternal ? ` · ${skippedExternal} external skipped` : ""}</p>
  ${renderCrossNav("links/report.html")}
  <section class="report-section">
    <div class="snapshot-chips">
      <span class="status-chip info">${filteredPages.length} Pages</span>
      <span class="status-chip ${pagesWithBrokenLinks > 0 ? "warn" : "pass"}">${pagesWithBrokenLinks} With broken links</span>
      <span class="status-chip ${broken.length > 0 ? "fail" : "pass"}">${broken.length} Broken links</span>
      <span class="status-chip ${skippedExternal > 0 ? "warn" : "pass"}">${skippedExternal} External skipped</span>
    </div>
  </section>
  <section class="report-section">
    <table class="report-table">
      <thead>
        <tr><th>URL</th><th>Broken</th><th>Checked</th><th>Skipped</th><th>Report</th></tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  </section>
  ${filteredPages.length ? "" : '<p class="summary">No broken links.</p>'}
</body>
</html>`;

  const htmlPath = path.join(reportDir, "report.html");
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

async function main() {
  ensureReportDirClean(REPORT_DIR);

  if (!CHECK_EXTERNAL && !QUIET_MODE) {
    console.log(
      "ℹ️  External links will be skipped (set CHECK_EXTERNAL_LINKS=1 to include).",
    );
  }

  let server = null;
  try {
    try {
      server = await ensureSiteServer();
    } catch (err) {
      console.error(
        `❌ Unable to start or reach site server at ${BASE_URL}: ${err.message}`,
      );
      throw err;
    }

    let pages = [];
    if (URLS_FILE) {
      if (!QUIET_MODE)
        console.log(`🔍 Loading URLs from ${URLS_FILE} for link check...`);
      pages = loadUrlsFromFile(URLS_FILE, BASE_URL);
    }
    if (!pages.length) {
      pages = getUrlsFromSitemap(BASE_URL);
    }
    if (!pages.length) {
      if (!QUIET_MODE)
        console.log(`🔍 Crawling site for link check at ${BASE_URL}...`);
      pages = await crawl();
    }
    if (!QUIET_MODE) {
      console.log(`✅ Found ${pages.length} pages:`);
      pages.forEach((u) => console.log("  -", u));
    }

    const pageResults = [];
    let skippedExternal = 0;

    for (const pageUrl of pages) {
      let res;
      try {
        res = await fetch(pageUrl);
      } catch (err) {
        console.error(`❌ Failed to fetch ${pageUrl}: ${err.message}`);
        pageResults.push({
          url: pageUrl,
          links: [
            {
              linkUrl: pageUrl,
              ok: false,
              status: 0,
              error: err.message,
              isExternal: false,
            },
          ],
        });
        continue;
      }

      const html = await res.text();
      const root = parse(html);
      const links = [];

      for (const anchor of root.querySelectorAll("a[href]")) {
        const href = anchor.getAttribute("href");
        if (!href) continue;
        if (shouldSkipLink(anchor, href)) continue;

        let absolute;
        try {
          absolute = href.startsWith("http")
            ? href
            : new URL(href, pageUrl).toString();
        } catch {
          continue;
        }

        const normalized = normalizeUrl(absolute);
        const isExternal = !isInternal(normalized);
        const selector = buildSelector(anchor);
        const text = (anchor.text || "").trim().slice(0, 120);
        links.push({
          linkUrl: normalized,
          isExternal,
          selector,
          text: text || undefined,
        });
      }

      const uniqueUrls = Array.from(new Set(links.map((l) => l.linkUrl)));
      const resultsByUrl = new Map();
      for (const url of uniqueUrls) {
        const sample = links.find((l) => l.linkUrl === url);
        const result = await checkLink(url, sample?.isExternal);
        resultsByUrl.set(url, result);
      }

      const evaluated = [];
      for (const link of links) {
        const result = resultsByUrl.get(link.linkUrl);
        evaluated.push({ ...link, ...result });
        if (result.skipped) skippedExternal += 1;
      }

      pageResults.push({ url: pageUrl, links: evaluated });
    }

    const broken = pageResults.flatMap((page) =>
      page.links
        .filter((l) => !l.ok && !l.skipped)
        .map((l) => ({
          pageUrl: page.url,
          linkUrl: l.linkUrl,
          status: l.status,
          error: l.error,
          isExternal: l.isExternal,
          selector: l.selector,
          text: l.text,
          headStatus: l.headStatus,
          headError: l.headError,
          fallbackUsed: l.fallbackUsed,
        })),
    );

    ensureDir(REPORT_DIR);

    const summaryPath = writeMarkdown(
      pageResults,
      broken,
      skippedExternal,
      REPORT_DIR,
    );
    const { count: pageReportCount, reportPathByUrl } = writeLinkPageReports(
      pageResults,
      REPORT_DIR,
      {
        brokenOnly: QUIET_MODE,
      },
    );
    const htmlPath = writeHtml(
      pageResults,
      broken,
      skippedExternal,
      REPORT_DIR,
      reportPathByUrl,
      {
        brokenOnly: QUIET_MODE,
      },
    );
    const jsonPath = path.join(REPORT_DIR, "links.json");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify({ pages: pageResults, broken, skippedExternal }, null, 2),
      "utf8",
    );

    if (QUIET_MODE) {
      if (broken.length === 0) {
        console.log("\n🎉 Link check passed: no broken links found.");
      } else {
        console.log(`\n🚫 Broken links (${broken.length}):`);
        broken.forEach((issue) => {
          console.log(
            `- ${issue.pageUrl} → ${issue.linkUrl} (${formatIssueStatusText(issue)})`,
          );
        });
        console.log(`Details saved to ${summaryPath}`);
      }
    } else {
      console.log(`\n📄 Link check summary (md): ${summaryPath}`);
      console.log(`📄 Link check report (html): ${htmlPath}`);
      console.log(
        `📄 Link page reports (html): ${path.join(REPORT_DIR, "pages")} (${pageReportCount} files)`,
      );
      console.log(`📄 Link data (json): ${jsonPath}`);
    }

    if (broken.length > 0) {
      if (!QUIET_MODE) {
        console.error(
          `\n🚫 Link check failed: ${broken.length} broken links found.`,
        );
      }
      process.exitCode = 1;
    } else {
      if (!QUIET_MODE) {
        console.log("\n🎉 Link check passed: no broken links found.");
      }
    }
  } finally {
    if (server && !server.killed) {
      server.kill("SIGINT");
    }
  }
}

main().catch((err) => {
  console.error("Unexpected error in link check script:", err);
  process.exit(1);
});
